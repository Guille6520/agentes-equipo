import { EvalNotFoundError, runNextStep } from "@/lib/evals/service";
import { redact } from "@/lib/security/redact";

// Ejecuta UNA prueba de UN modelo (timeout de 45 s por llamada) y guarda el resultado. Pasa por un
// lease en BD: si hay otro paso en curso responde `busy` sin hacer nada. maxDuration 60 s cubre el
// plan Hobby incluso sin Fluid Compute.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(_req: Request, ctx: RouteContext<"/api/evals/[id]/step">) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Identificador no válido." }, { status: 400, headers: NO_STORE });
  }
  try {
    return Response.json(await runNextStep(id), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof EvalNotFoundError) {
      return Response.json({ error: "Evaluación no encontrada." }, { status: 404, headers: NO_STORE });
    }
    console.error("[evals] step", id, redact(e instanceof Error ? e.message : String(e)));
    return Response.json({ error: "No se pudo ejecutar el paso." }, { status: 500, headers: NO_STORE });
  }
}
