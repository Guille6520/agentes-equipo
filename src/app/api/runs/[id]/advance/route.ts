import { advanceRun } from "@/lib/engine";

// Avanza UN paso del run. Lo llama la UI cuando un run en curso deja de progresar (el bucle de
// `after()` se cortó, la función expiró o el usuario recargó). Pasa por el mismo lease que el
// bucle, así que nunca hay dos avances a la vez: si está ocupado responde `busy` sin hacer nada.
// Un paso puede tardar hasta ~3 min en el peor caso (3 llamadas de 60 s): ver ../../route.ts.
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(_req: Request, ctx: RouteContext<"/api/runs/[id]/advance">) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Identificador no válido." }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await advanceRun(id);
    return Response.json(result, { headers: NO_STORE });
  } catch (e) {
    console.error("[engine] advance", id, e instanceof Error ? e.message : e);
    return Response.json({ error: "No se pudo avanzar la ejecución." }, { status: 500, headers: NO_STORE });
  }
}
