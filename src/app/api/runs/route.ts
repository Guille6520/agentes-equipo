import { desc } from "drizzle-orm";
import { z } from "zod";
import { db, events, runs } from "@/db";
import type { CreateRunResponse, RunListResponse } from "@/lib/types";
import { toRunDTO } from "./_serialize";

// Los GET de Route Handlers son dinámicos por defecto en esta versión de Next
// (y con cacheComponents no se permite `export const dynamic`), así que no hay caché.

const NO_STORE = { "Cache-Control": "no-store" };

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
      .values({ request: parsed.data.request, status: "running" })
      .returning();

    await db.insert(events).values({
      runId: run.id,
      agent: "orchestrator",
      message: "Petición recibida",
    });

    // TODO(motor): aquí hay que lanzar el motor de agentes (orquestador ->
    // develop -> testing) para este run. De momento solo se crea el run y el
    // evento inicial; el motor real se conectará más adelante.

    const body: CreateRunResponse = { run: toRunDTO(run) };
    return Response.json(body, { status: 201, headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "No se pudo crear la ejecución." },
      { status: 500, headers: NO_STORE },
    );
  }
}
