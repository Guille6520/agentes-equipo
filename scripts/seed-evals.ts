// Carga en BD los resultados de los benchmarks manuales del 23/11/2026:
//   - 'manual-2026-11-23': 8 modelos de NVIDIA y Google (docs/model-comparison.md).
//   - 'manual-groq-2026-11-23': 3 candidatos de Groq medidos con scripts/bench-groq.ts
//     (2 ejecuciones por prueba; ver docs/seleccion-de-modelos.md, "Tercer proveedor: Groq").
// Uso: npx tsx scripts/seed-evals.ts [--force]   (lee DATABASE_URL de .env.local; no se imprime)
// Idempotente por origen: si una evaluación ya existe no se toca. Con --force se recargan las dos
// (solo se borran esas evaluaciones y sus resultados; nunca los runs de los agentes ni otras evaluaciones).
// Los valores "no medido" del informe quedan sin veredicto (ok = null, status = not_measured).
import { config } from "dotenv";

config({ path: ".env.local" });

type Test = "orchestrator" | "develop" | "testing";
interface Row {
  model: string;
  provider: "nvidia" | "google" | "groq";
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
const groqRows: Row[] = [];
const add = (model: string, provider: Row["provider"], test: Test, r: Omit<Row, "model" | "provider" | "test">) =>
  rows.push({ model, provider, test, ...r });
const addGroq = (model: string, test: Test, r: Omit<Row, "model" | "provider" | "test">) =>
  groqRows.push({ model, provider: "groq", test, ...r });
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

// ---------- Groq (scripts/bench-groq.ts, 23/11/2026) ----------
// Dos ejecuciones por prueba, sin respaldo. Cada fila resume las dos: ok solo si ambas pasaron,
// latencia media de las ejecuciones sin error y, en Develop, el peor resultado de checks. Las cifras de
// cada ejecución van en `note` y en docs/seleccion-de-modelos.md.
const runsNote = (a: string, b: string) => `2 ejecuciones: ${a}; ${b}`;
// openai/gpt-oss-20b: 6 de 6 correctas (elegido como respaldo de Groq).
{
  const m = "openai/gpt-oss-20b";
  addGroq(m, "orchestrator", { status: "done", ok: true, metrics: { latencyMs: 802, jsonValid: true, strictJson: true, sensible: true, tasks: 4, note: runsNote("4 tareas, 0,7 s", "4 tareas, 0,9 s") } });
  addGroq(m, "develop", { status: "done", ok: true, metrics: { latencyMs: 1888, tokens: 1565, compiles: true, checksPassed: 5, checksTotal: 5, note: runsNote("compila 5/5, 2,1 s", "compila 5/5, 1,7 s") } });
  addGroq(m, "testing", { status: "done", ok: true, metrics: { latencyMs: 900, bug1: true, bug2: true, both: true, note: runsNote("2/2, 1,0 s", "2/2, 0,8 s") } });
}
// openai/gpt-oss-120b: 5 de 6; un Develop no compiló (error de tipos en <style jsx>).
{
  const m = "openai/gpt-oss-120b";
  addGroq(m, "orchestrator", { status: "done", ok: true, metrics: { latencyMs: 1077, jsonValid: true, strictJson: true, sensible: true, tasks: 5, note: runsNote("5 tareas, 1,3 s", "5 tareas, 0,8 s") } });
  addGroq(m, "develop", { status: "done", ok: false, metrics: { latencyMs: 4289, tokens: 1893, compiles: false, checksPassed: 4, checksTotal: 5, failedChecks: ["Sintaxis y tipos: TS2322 en <style jsx> (1 de 2 ejecuciones)"], note: runsNote("no compila 4/5, 3,8 s", "compila 5/5, 4,7 s") } });
  addGroq(m, "testing", { status: "done", ok: true, metrics: { latencyMs: 859, bug1: true, bug2: true, both: true, note: runsNote("2/2, 1,0 s", "2/2, 0,7 s") } });
}
// qwen/qwen3.8-27b: 5 de 6; un Testing con 429 incluso tras repetir, y 429 en un Develop (bien al repetir).
{
  const m = "qwen/qwen3.8-27b";
  addGroq(m, "orchestrator", { status: "done", ok: true, metrics: { latencyMs: 1027, jsonValid: true, strictJson: true, sensible: true, tasks: 4, note: runsNote("4 tareas, 1,0 s", "4 tareas, 1,1 s") } });
  addGroq(m, "develop", { status: "done", ok: true, metrics: { latencyMs: 10533, tokens: 3542, compiles: true, checksPassed: 3, checksTotal: 7, failedChecks: ["Accesibilidad: campos sin label asociado (1 de 2 ejecuciones)", "Formulario de contacto: falta el campo mensaje (1 de 2 ejecuciones)"], note: runsNote("compila 3/7, 12,5 s", "compila 5/5, 8,5 s tras un 429 repetido") } });
  addGroq(m, "testing", { status: "done", ok: false, error: "HTTP 429 (cuota/limite) en 1 de 2 ejecuciones", metrics: { latencyMs: 879, bug1: true, bug2: true, both: true, note: runsNote("HTTP 429 también al repetir", "2/2, 0,9 s") } });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL en .env.local");
    process.exit(1);
  }
  const { eq } = await import("drizzle-orm");
  const { db, evalRuns, evalResults } = await import("../src/db");
  const force = process.argv.includes("--force");
  const datasets = [
    { origin: "manual-2026-11-23", at: new Date("2026-11-23T12:00:00Z"), rows, label: "8 modelos" },
    { origin: "manual-groq-2026-11-23", at: new Date("2026-11-23T17:00:00Z"), rows: groqRows, label: "3 modelos de Groq" },
  ];

  for (const ds of datasets) {
    const existing = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.origin, ds.origin));
    if (existing.length > 0 && !force) {
      console.log(`Ya existe la evaluación '${ds.origin}' (id ${existing[0].id}); nada que hacer. Usa --force para recargarla.`);
      continue;
    }
    if (existing.length > 0) {
      await db.delete(evalRuns).where(eq(evalRuns.origin, ds.origin)); // cascada: solo sus resultados
      console.log(`Evaluación '${ds.origin}' anterior eliminada (--force).`);
    }
    const [run] = await db
      .insert(evalRuns)
      .values({ origin: ds.origin, status: "done", createdAt: ds.at, finishedAt: ds.at })
      .returning();
    await db.insert(evalResults).values(
      ds.rows.map((r, i) => ({
        runId: run.id,
        model: r.model,
        provider: r.provider,
        test: r.test,
        step: i,
        status: r.status,
        ok: r.ok,
        metrics: r.metrics ?? null,
        error: r.error ?? null,
        createdAt: ds.at,
        finishedAt: ds.at,
      })),
    );
    console.log(`Evaluación '${ds.origin}' cargada: run ${run.id}, ${ds.rows.length} resultados (${ds.label}).`);
  }
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message.slice(0, 200) : "desconocido");
  process.exit(1);
});
