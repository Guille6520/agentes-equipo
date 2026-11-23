// Protección de la demo pública: un solo run del motor a la vez y un máximo por hora.
// Se comprueba en BD (no en memoria) porque cada petición puede caer en una instancia distinta.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const MAX_RUNS_PER_HOUR = 10;
/** Un run "running" sin eventos desde hace más de esto se considera abandonado y no bloquea. */
export const STALE_AFTER_MIN = 15;

export interface LimitSnapshot {
  /** Runs del motor en curso con actividad reciente. */
  activeRuns: number;
  /** Runs del motor creados en la última hora. */
  runsLastHour: number;
  /** Segundos hasta que el run más antiguo de la última hora salga de la ventana (0 si no hay). */
  secondsUntilSlot: number;
}

export type LimitDecision = { ok: true } | { ok: false; status: 409 | 429; error: string };

/** Decisión pura a partir de las cifras de BD (testeable sin BD). */
export function decideLimits(s: LimitSnapshot): LimitDecision {
  if (s.activeRuns > 0) {
    return { ok: false, status: 409, error: "Ya hay una ejecución en curso; espera a que termine" };
  }
  if (s.runsLastHour >= MAX_RUNS_PER_HOUR) {
    const min = Math.max(1, Math.ceil(s.secondsUntilSlot / 60));
    return {
      ok: false,
      status: 429,
      error: `Límite de ${MAX_RUNS_PER_HOUR} ejecuciones por hora alcanzado; vuelve a intentarlo en ${min} min`,
    };
  }
  return { ok: true };
}

export async function readLimitSnapshot(): Promise<LimitSnapshot> {
  const res = await db.execute(sql`
    select
      (select count(*)::int from runs r
         where r.status = 'running' and r.engine_managed
           and coalesce((select max(e.created_at) from events e where e.run_id = r.id), r.created_at)
               > now() - make_interval(mins => ${STALE_AFTER_MIN})) as active_runs,
      (select count(*)::int from runs where engine_managed and created_at > now() - interval '1 hour') as runs_last_hour,
      coalesce((select extract(epoch from (min(created_at) + interval '1 hour' - now()))::int
         from runs where engine_managed and created_at > now() - interval '1 hour'), 0) as seconds_until_slot
  `);
  const row = res.rows[0] as { active_runs: number; runs_last_hour: number; seconds_until_slot: number };
  return {
    activeRuns: Number(row.active_runs),
    runsLastHour: Number(row.runs_last_hour),
    secondsUntilSlot: Number(row.seconds_until_slot),
  };
}

export async function checkRunLimits(): Promise<LimitDecision> {
  return decideLimits(await readLimitSnapshot());
}
