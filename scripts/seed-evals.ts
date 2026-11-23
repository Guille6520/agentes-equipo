// Carga en BD los resultados del benchmark manual del 23/11/2026 (docs/model-comparison.md).
// Uso: npx tsx scripts/seed-evals.ts [--force]   (lee DATABASE_URL de .env.local; no se imprime)
// Idempotente: si ya existe la evaluación 'manual-2026-11-23' no hace nada. Con --force la recarga
// (solo borra esa evaluación y sus resultados; nunca toca los runs de los agentes ni otras evaluaciones).
// Los valores "no medido" del informe quedan sin veredicto (ok = null, status = not_measured).
import { config } from "dotenv";

config({ path: ".env.local" });

type Test = "orchestrator" | "develop" | "testing";
interface Row {
  model: string;
  provider: "nvidia" | "google";
  test: Test;
  status: "done" | "not_measured";
  ok: boolean | null;
  metrics?: Record<string, unknown>;
  error?: string;
}

const TIMEOUT = "timeout 90 s (2 ejecuciones)";
// El informe indica "4 tareas" solo para laguna, gemini-3.1-flash-lite y gemini-3.5-flash.
const orch = (ms: number, avg?: number, tasks?: number): Record<string, unknown> => ({
  latencyMs: ms, jsonValid: true, sensible: true, ...(tasks ? { tasks } : {}), ...(avg ? { reportedAvgMs: avg } : {}),
});

const rows: Row[] = [];
const add = (model: string, provider: Row["provider"], test: Test, r: Omit<Row, "model" | "provider" | "test">) =>
  rows.push({ model, provider, test, ...r });
const notMeasured = (model: string, provider: Row["provider"], test: Test, note: string) =>
  add(model, provider, test, { status: "not_measured", ok: null, metrics: { note } });

// poolside/laguna-xs-2.1 (NVIDIA): latencia media ~6 s; Develop ~14 s según la recomendación del informe.
{
  const m = "poolside/laguna-xs-2.1", p = "nvidia" as const;
  add(m, p, "orchestrator", { status: "done", ok: true, metrics: orch(2300, 6000, 4) });
  add(m, p, "develop", { status: "done", ok: true, metrics: { latencyMs: 14000, latencyApprox: true, tokens: 1128, compiles: true, checksPassed: 9, checksTotal: 9 } });
  add(m, p, "testing", { status: "done", ok: true, metrics: { latencyMs: 1500, bug1: true, bug2: true, both: true } });
}
// gemini-3.1-flash-lite (Google): latencia media ~3 s; el informe no desglosa la latencia de Develop.
{
  const m = "gemini-3.1-flash-lite", p = "google" as const;
  add(m, p, "orchestrator", { status: "done", ok: true, metrics: orch(2400, 3000, 4) });
  add(m, p, "develop", { status: "done", ok: true, metrics: { latencyMs: null, tokens: 1034, compiles: true, checksPassed: 8, checksTotal: 9, note: "Latencia de Develop no desglosada en el informe" } });
  add(m, p, "testing", { status: "done", ok: true, metrics: { latencyMs: 2400, bug1: true, bug2: true, both: true } });
}
// gemini-3.5-flash: JSON válido en 15 s en una ejecución; 503 "high demand" en la otra.
{
  const m = "gemini-3.5-flash", p = "google" as const;
  add(m, p, "orchestrator", { status: "done", ok: true, metrics: { ...orch(15000, 15000, 4), note: "503 'high demand' en la otra ejecución" } });
  notMeasured(m, p, "develop", "No medido (503 'high demand' repetidos)");
  notMeasured(m, p, "testing", "No medido (503 'high demand' repetidos)");
}
// mistralai/mistral-large-4-1t-a52b: media ~69 s; Develop con timeout de 90 s en ambas ejecuciones.
{
  const m = "mistralai/mistral-large-4-1t-a52b", p = "nvidia" as const;
  add(m, p, "orchestrator", { status: "done", ok: true, metrics: orch(75000, 69000) });
  add(m, p, "develop", { status: "done", ok: false, error: TIMEOUT, metrics: { note: "No medido: sin respuesta" } });
  add(m, p, "testing", { status: "done", ok: true, metrics: { latencyMs: 63000, bug1: true, bug2: true, both: true } });
}
// minimaxai/minimax-m3.1-flash: media ~87 s; Develop con timeout en ambas ejecuciones.
{
  const m = "minimaxai/minimax-m3.1-flash", p = "nvidia" as const;
  add(m, p, "orchestrator", { status: "done", ok: true, metrics: orch(89000, 87000) });
  add(m, p, "develop", { status: "done", ok: false, error: "timeout 90 s (x2)", metrics: { note: "No medido: sin respuesta" } });
  add(m, p, "testing", { status: "done", ok: true, metrics: { latencyMs: 85000, bug1: true, bug2: true, both: true } });
}
// kimi-k3.1-pro y glm-5.3-flash: Orquestador con timeout de 90 s en 2 ejecuciones; resto no medido.
for (const m of ["moonshotai/kimi-k3.1-pro", "z-ai/glm-5.3-flash"]) {
  add(m, "nvidia", "orchestrator", { status: "done", ok: false, error: TIMEOUT });
  notMeasured(m, "nvidia", "develop", "No medido (sin respuesta en el Orquestador)");
  notMeasured(m, "nvidia", "testing", "No medido (sin respuesta en el Orquestador)");
}
// gemini-2.5-flash: 404 con esta clave.
{
  const m = "gemini-2.5-flash", p = "google" as const;
  add(m, p, "orchestrator", { status: "done", ok: false, error: "HTTP 404: no longer available to new users" });
  notMeasured(m, p, "develop", "No medido (404 en el Orquestador)");
  notMeasured(m, p, "testing", "No medido (404 en el Orquestador)");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL en .env.local");
    process.exit(1);
  }
  const { eq } = await import("drizzle-orm");
  const { db, evalRuns, evalResults } = await import("../src/db");
  const ORIGIN = "manual-2026-11-23";
  const force = process.argv.includes("--force");

  const existing = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.origin, ORIGIN));
  if (existing.length > 0 && !force) {
    console.log(`Ya existe la evaluación manual (id ${existing[0].id}); nada que hacer. Usa --force para recargarla.`);
    return;
  }
  if (existing.length > 0) {
    await db.delete(evalRuns).where(eq(evalRuns.origin, ORIGIN)); // cascada: solo sus resultados
    console.log("Evaluación manual anterior eliminada (--force).");
  }

  const at = new Date("2026-11-23T12:00:00Z");
  const [run] = await db
    .insert(evalRuns)
    .values({ origin: ORIGIN, status: "done", createdAt: at, finishedAt: at })
    .returning();
  await db.insert(evalResults).values(
    rows.map((r, i) => ({
      runId: run.id,
      model: r.model,
      provider: r.provider,
      test: r.test,
      step: i,
      status: r.status,
      ok: r.ok,
      metrics: r.metrics ?? null,
      error: r.error ?? null,
      createdAt: at,
      finishedAt: at,
    })),
  );
  console.log(`Evaluación manual cargada: run ${run.id}, ${rows.length} resultados (8 modelos).`);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message.slice(0, 200) : "desconocido");
  process.exit(1);
});
