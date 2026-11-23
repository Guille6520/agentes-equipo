import { desc } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db, events, runs } from "@/db";
import { advanceLoop } from "@/lib/engine";
import type { CreateRunResponse, RunListResponse } from "@/lib/types";
import { toRunDTO } from "./_serialize";

// Los GET de Route Handlers son dinámicos por defecto en esta versión de Next
// (y con cacheComponents no se permite `export const dynamic`), así que no hay caché.

const NO_STORE = { "Cache-Control": "no-store" };

// Vercel Hobby (Fluid Compute, activo por defecto) permite hasta 300 s por función; `after()` corre
// dentro de ese mismo límite. Si el proyecto tuviera Fluid desactivado el máximo sería 60 s: el bucle
// se cortaría antes y la UI terminaría el run con POST /api/runs/[id]/advance.
export const maxDuration = 300;
/** Solo se empieza un paso nuevo si han pasado menos de 200 s (margen para un paso lento). */
const LOOP_BUDGET_MS = 200_000;

export async function GET() {
  try {
    const rows = await db.select().from(runs).orderBy(desc(runs.id)).limit(30);
    const body: RunListResponse = { runs: rows.map(toRunDTO) };
    return Response.json(body, { headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "No se pudo leer la lista de ejecuciones." },
      { status: 500, headers: NO_STORE },
    );
  }
}

const createSchema = z.object({
  request: z.string().trim().min(1).max(2000),
  forceInitialFailure: z.boolean().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "La petición debe tener entre 1 y 2000 caracteres." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const [run] = await db
      .insert(runs)
      .values({
        request: parsed.data.request,
        status: "running",
        engineManaged: true,
        demoForceFailure: parsed.data.forceInitialFailure === true,
      })
      .returning();

    await db.insert(events).values({
      runId: run.id,
      agent: "orchestrator",
      message: run.demoForceFailure
        ? "Petición recibida (modo demo: fallo inicial forzado)"
        : "Petición recibida",
    });

    // Motor: se responde ya y los agentes trabajan después de la respuesta. Cada paso persiste su
    // estado en BD; si este bucle se corta, la UI lo retoma llamando a /api/runs/[id]/advance.
    after(async () => {
      try {
        await advanceLoop(run.id, { budgetMs: LOOP_BUDGET_MS });
      } catch (e) {
        console.error("[engine] bucle de avance interrumpido", run.id, e instanceof Error ? e.message : e);
      }
    });

    const body: CreateRunResponse = { run: toRunDTO(run) };
    return Response.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "No se pudo crear la ejecución." },
      { status: 500, headers: NO_STORE },
    );
  }
}
