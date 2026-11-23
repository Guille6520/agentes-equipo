import { createEvalRun, getOverview } from "@/lib/evals/service";

const NO_STORE = { "Cache-Control": "no-store" };

// Protegida por el login (src/proxy.ts). Crear una evaluación solo prepara los 6 pasos en BD; los
// modelos se llaman uno a uno desde /api/evals/[id]/step.

export async function GET() {
  try {
    return Response.json(await getOverview(), { headers: NO_STORE });
  } catch (e) {
    console.error("[evals] overview", e instanceof Error ? e.message : e);
    return Response.json({ error: "No se pudo leer la evaluación." }, { status: 500, headers: NO_STORE });
  }
}

export async function POST() {
  try {
    const out = await createEvalRun();
    if (out.kind === "created") return Response.json({ run: out.run }, { status: 201, headers: NO_STORE });
    if (out.kind === "running") {
      return Response.json(
        { error: "Ya hay una evaluación en curso.", runId: out.runId },
        { status: 409, headers: NO_STORE },
      );
    }
    const mins = Math.ceil(out.retryAfterSeconds / 60);
    return Response.json(
      {
        error: `Solo se permite una evaluación nueva cada 10 minutos. Faltan ${out.retryAfterSeconds} s (unos ${mins} min).`,
        retryAfterSeconds: out.retryAfterSeconds,
      },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(out.retryAfterSeconds) } },
    );
  } catch (e) {
    console.error("[evals] create", e instanceof Error ? e.message : e);
    return Response.json({ error: "No se pudo crear la evaluación." }, { status: 500, headers: NO_STORE });
  }
}
