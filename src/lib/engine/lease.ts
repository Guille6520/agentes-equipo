// Lease en BD para que solo un proceso avance un run a la vez.
//
// Se adquiere con un UPDATE atómico condicionado (locked_until vencido o nulo) y se renueva con un
// latido mientras dura el paso. Si la función serverless muere a mitad de paso, el latido se para y
// el lease caduca en LEASE_SECONDS: otro disparador (el bucle o la UI) puede retomar el run.
// Todas las horas se comparan con now() de Postgres para no depender del reloj de cada función.
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, runs } from "@/db";

export const LEASE_SECONDS = 60;
const HEARTBEAT_MS = 20_000;

const leaseExpiry = sql`now() + make_interval(secs => ${LEASE_SECONDS})`;

export class LeaseLostError extends Error {
  constructor() {
    super("Se perdió el lease del run");
    this.name = "LeaseLostError";
  }
}

export interface Lease {
  runId: number;
  token: string;
  /** Comprueba (y renueva) que el lease sigue siendo nuestro; lanza LeaseLostError si no. */
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

/** Intenta adquirir el lease de un run en curso y gestionado por el motor. null si está ocupado. */
export async function acquireLease(runId: number): Promise<Lease | null> {
  const token = randomUUID();
  const rows = await db
    .update(runs)
    .set({ lockedUntil: leaseExpiry, lockToken: token })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "running"),
        eq(runs.engineManaged, true),
        or(isNull(runs.lockedUntil), lt(runs.lockedUntil, sql`now()`)),
      ),
    )
    .returning({ id: runs.id });
  if (rows.length === 0) return null;

  const renew = async () => {
    const r = await db
      .update(runs)
      .set({ lockedUntil: leaseExpiry })
      .where(and(eq(runs.id, runId), eq(runs.lockToken, token)))
      .returning({ id: runs.id });
    return r.length > 0;
  };

  let lost = false;
  const timer = setInterval(() => {
    renew()
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => {
        /* un fallo puntual de red no invalida el lease; se reintenta en el siguiente latido */
      });
  }, HEARTBEAT_MS);
  // No mantener vivo el proceso solo por el latido (scripts de Node).
  timer.unref?.();

  return {
    runId,
    token,
    async assertHeld() {
      if (lost || !(await renew())) {
        lost = true;
        throw new LeaseLostError();
      }
    },
    async release() {
      clearInterval(timer);
      await db
        .update(runs)
        .set({ lockedUntil: null, lockToken: null })
        .where(and(eq(runs.id, runId), eq(runs.lockToken, token)));
    },
  };
}
