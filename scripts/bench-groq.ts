// Benchmark de modelos con las MISMAS tres pruebas y la misma puntuación que la página /evals
// (src/lib/evals: Orquestador JSON, Develop con runChecks perfil contact-form y Testing con 2 fallos
// plantados). Cada llamada va al modelo indicado SIN respaldo entre proveedores (runEvalStep).
//
// Uso: npx tsx scripts/bench-groq.ts [--reps=2] [--pause=8] [--only=openai/gpt-oss-120b,...] [--json=ruta]
// Por defecto mide los candidatos de Groq (GROQ_CANDIDATES). Lee las claves de .env.local y nunca las
// imprime: la salida solo lleva etiquetas cortas de error (describeError).
//
// Ritmo: secuencial y con pausa entre llamadas para quedar muy por debajo del límite gratuito de Groq
// (~30 peticiones/min por modelo; también hay límite de tokens por minuto). Si aun así llega un 429, se
// espera 30 s y se repite esa llamada UNA vez; queda anotado en la columna de error.
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const REPS = Number(arg("reps") ?? 2);
const PAUSE_MS = Number(arg("pause") ?? 8) * 1000;
const RETRY_429_MS = 30_000;
const ONLY = arg("only")?.split(",");
const JSON_OUT = arg("json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  model: string;
  test: string;
  rep: number;
  ok: boolean | null;
  latencyMs: number | null;
  checks: string;
  error: string;
  /** La llamada recibió un 429 y se repitió una vez. */
  retried429: boolean;
  metrics: unknown;
}

async function main() {
  const { GROQ_CANDIDATES } = await import("../src/lib/ai/models");
  const { EVAL_TESTS, TEST_LABEL } = await import("../src/lib/evals/models");
  const { runEvalStep } = await import("../src/lib/evals/run-step");

  const models = GROQ_CANDIDATES.filter((m) => !ONLY || ONLY.includes(m.id));
  const envKeys = [...new Set(models.map((m) => m.envKey))];
  for (const k of envKeys) if (!process.env[k]) console.warn(`Aviso: falta ${k} en .env.local`);

  const rows: Row[] = [];
  const total = REPS * models.length * EVAL_TESTS.length;
  let n = 0;
  // Orden: repetición -> modelo -> prueba, para separar en el tiempo las dos muestras de cada modelo.
  for (let rep = 1; rep <= REPS; rep++) {
    for (const model of models) {
      for (const test of EVAL_TESTS) {
        n++;
        let out = await runEvalStep(model, test);
        let retried429 = false;
        if (out.error?.startsWith("HTTP 429")) {
          retried429 = true;
          await sleep(RETRY_429_MS);
          out = await runEvalStep(model, test);
        }
        const m = out.metrics ?? {};
        const checks =
          test === "develop" && m.checksTotal != null
            ? `${m.checksPassed}/${m.checksTotal}`
            : test === "testing" && m.bug1 != null
              ? `${(m.bug1 ? 1 : 0) + (m.bug2 ? 1 : 0)}/2 fallos`
              : test === "orchestrator" && m.jsonValid != null
                ? `${m.tasks ?? 0} tareas${m.strictJson === false ? ", JSON no estricto" : ""}`
                : "-";
        const row: Row = {
          model: model.id,
          test: TEST_LABEL[test],
          rep,
          ok: out.ok,
          latencyMs: m.latencyMs ?? null,
          checks,
          error: out.error ?? "",
          retried429,
          metrics: out.metrics,
        };
        rows.push(row);
        console.log(
          `[${n}/${total}] ${model.label} · ${row.test} #${rep}: ${row.ok ? "ok" : "FALLO"} · ${fmt(row.latencyMs)} · ${checks}${row.error ? ` · ${row.error}` : ""}${retried429 ? " · 429 y repetida tras 30 s" : ""}`,
        );
        if (n < total) await sleep(PAUSE_MS);
      }
    }
  }

  console.log("\n| Modelo | Prueba | Rep. | ok | Latencia | Checks | Error |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.model} | ${r.test} | ${r.rep} | ${r.ok ? "sí" : "no"} | ${fmt(r.latencyMs)} | ${r.checks} | ${r.error || "-"} |`);
  }

  console.log("\nResumen por modelo:");
  for (const model of models) {
    const rs = rows.filter((r) => r.model === model.id);
    const okCount = rs.filter((r) => r.ok).length;
    const lat = rs.filter((r) => !r.error && r.latencyMs != null).map((r) => r.latencyMs!);
    const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
    const errors = rs.filter((r) => r.error).length;
    const r429 = rs.filter((r) => r.retried429).length;
    console.log(`- ${model.id}: ${okCount}/${rs.length} ok, ${errors} errores, ${r429} con 429 repetida, latencia media ${fmt(avg)}`);
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
    console.log(`\nResultados en ${JSON_OUT}`);
  }
}

function fmt(ms: number | null): string {
  return ms == null ? "-" : `${(ms / 1000).toFixed(1)} s`;
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message.slice(0, 200) : "desconocido");
  process.exit(1);
});
