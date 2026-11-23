// Benchmark de modelos con los PROMPTS REALES DEL MOTOR (no los de /evals).
//
// Uso:
//   npx tsx scripts/bench-prompts.ts --phase=selftest          comprueba los datos fijos (sin red)
//   npx tsx scripts/bench-prompts.ts --phase=calls [--reps=3] [--only=id1,id2]
//       A. Orquestador (4 peticiones) · B. Develop (2 tareas con criterios) · C. Testing (feedback de 2 fallos)
//       Cada llamada va a UN modelo, sin respaldo, con el prompt de sistema real, el mismo formato de
//       prompt de usuario que construye el motor, sus maxOutputTokens, temperatura y timeout por rol.
//   npx tsx scripts/bench-prompts.ts --phase=runs [--only=id1,id2]
//       Runs completos del motor (advanceRun en bucle, como scripts/e2e-engine.ts) con cada candidato
//       como PRINCIPAL: el orden de ROLE_MODELS se cambia SOLO en memoria de este proceso.
//   npx tsx scripts/bench-prompts.ts --phase=cleanup
//       Borra los runs «[prueba prompts]» (cascada: tareas, archivos, eventos) y lista los que quedan.
//
// Lee .env.local y nunca imprime claves: los errores salen como etiquetas cortas (describeError).
// Ritmo: limitador por ventana deslizante de 60 s por modelo de Groq (8.000 tokens/min en el plan
// gratuito) y >= 2 s entre llamadas a NVIDIA (~40 peticiones/min). Cada 429 se registra; en la fase
// "calls" se espera 60 s y se repite UNA vez (queda marcado).
// Resultados: scripts/.bench-prompts/*.json (carpeta ignorada por git).
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PHASE = arg("phase") ?? "selftest";
const REPS = Number(arg("reps") ?? 3);
const ONLY = arg("only")?.split(",");
const OUT_DIR = "scripts/.bench-prompts";
const RUN_MARK = "[prueba prompts]";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function save(name: string, data: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}/${name}-${stamp()}.json`;
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`\nResultados en ${path}`);
}

// ---------------------------------------------------------------------------------------------
// Contador de llamadas HTTP a los proveedores (fetch global, que usa el AI SDK): peticiones y 429.
// neon-http también usa fetch; se filtra por host.
// ---------------------------------------------------------------------------------------------
const HOSTS: Record<string, string> = {
  "api.groq.com": "groq",
  "integrate.api.nvidia.com": "nvidia",
  "generativelanguage.googleapis.com": "google",
};
interface HttpLog { provider: string; status: number; at: number }
const httpLog: HttpLog[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {}
  const res = await originalFetch(input, init);
  const provider = HOSTS[host];
  if (provider) httpLog.push({ provider, status: res.status, at: Date.now() });
  return res;
}) as typeof fetch;

// ---------------------------------------------------------------------------------------------
// Datos fijos
// ---------------------------------------------------------------------------------------------
const ORCH_REQUESTS = [
  { id: "contacto", request: "Añade una página de contacto a esta web", expect: "plan" as const },
  { id: "precios", request: "Crea una tabla de precios con tres planes", expect: "plan" as const },
  { id: "video", request: "Hazme un vídeo de un gato bailando", expect: "out-of-scope" as const },
  { id: "logo-svg", request: "Crea un logotipo en SVG de una taza de café", expect: "plan" as const },
];

type Criterion =
  | { type: "text"; value: string }
  | { type: "element"; selector: string; min?: number }
  | { type: "field"; name: string; required?: boolean }
  | { type: "heading"; text: string; level?: number }
  | { type: "link"; text: string };

const DEV_TASKS: { id: string; request: string; title: string; description: string; acceptance: Criterion[] }[] = [
  {
    id: "contacto",
    request: "Añade una página de contacto a esta web",
    title: "Formulario de contacto",
    description:
      "Componente ContactForm con un formulario de contacto con los campos nombre, email y mensaje, todos obligatorios. " +
      "Valida que el email tenga formato correcto y muestra un mensaje de confirmación accesible al enviar (envío simulado).",
    acceptance: [
      { type: "heading", text: "Contacto" },
      { type: "field", name: "name", required: true },
      { type: "field", name: "email", required: true },
      { type: "element", selector: "textarea" },
      { type: "text", value: "Enviar" },
    ],
  },
  {
    id: "precios",
    request: "Crea una tabla de precios con tres planes",
    title: "Tabla de precios",
    description:
      "Componente PricingTable que muestra tres planes (Básico, Pro y Empresa) con su precio mensual, una lista de " +
      "características y un botón «Elegir plan» en cada uno. El plan Pro aparece destacado.",
    acceptance: [
      { type: "heading", text: "Precios" },
      { type: "text", value: "Básico" },
      { type: "text", value: "Empresa" },
      { type: "element", selector: "button", min: 3 },
      { type: "element", selector: "li", min: 6 },
    ],
  },
];

/** Componente con DOS fallos conocidos: email sin type="email" (check de formulario) e img sin alt (a11y). */
const BUGGY_PATH = "components/ContactForm.tsx";
const BUGGY_CODE = `"use client";
import { useState, type FormEvent } from "react";

export default function ContactForm() {
  const [status, setStatus] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("Mensaje enviado correctamente.");
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <img src="/logo.svg" className="h-8" />
      <h1 className="text-2xl font-bold">Contacto</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="name">Nombre</label>
        <input id="name" name="name" type="text" required />

        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="text" required />

        <label htmlFor="message">Mensaje</label>
        <textarea id="message" name="message" required />

        <button type="submit">Enviar</button>
        <div role="status" aria-live="polite">{status}</div>
      </form>
    </main>
  );
}
`;
/** Heurísticas: ¿el feedback menciona cada fallo? */
const BUG_EMAIL = /type\s*=\s*["'{]?\s*["']?email|type=\\?"email|tipo\s+(de\s+)?["«]?email|type\s+["«]?email/i;
const BUG_ALT = /\balt\b|texto alternativo/i;

// ---------------------------------------------------------------------------------------------
// Ritmo por proveedor
// ---------------------------------------------------------------------------------------------
const GROQ_TPM = 8_000;
const GROQ_BUDGET = 7_200; // margen bajo el límite
const tokenWindow = new Map<string, { at: number; tokens: number }[]>();
let lastNvidiaAt = 0;

async function pace(spec: { provider: string; id: string }, estimate: number) {
  if (spec.provider === "nvidia") {
    const wait = lastNvidiaAt + 2_000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastNvidiaAt = Date.now();
    return;
  }
  if (spec.provider !== "groq") return;
  const win = tokenWindow.get(spec.id) ?? [];
  tokenWindow.set(spec.id, win);
  for (;;) {
    const now = Date.now();
    while (win.length && now - win[0].at > 61_000) win.shift();
    const used = win.reduce((a, b) => a + b.tokens, 0);
    if (used + Math.min(estimate, GROQ_BUDGET) <= GROQ_BUDGET || win.length === 0) return;
    const wait = win[0].at + 61_000 - now;
    console.log(`    (pausa ${Math.ceil(wait / 1000)} s por el límite de tokens/min de ${spec.id}: ${used} usados)`);
    await sleep(wait);
  }
}
function spend(spec: { provider: string; id: string }, tokens: number) {
  if (spec.provider !== "groq") return;
  tokenWindow.get(spec.id)?.push({ at: Date.now(), tokens });
}

// ---------------------------------------------------------------------------------------------
// Fase calls
// ---------------------------------------------------------------------------------------------
interface CallRecord {
  model: string;
  test: "orchestrator" | "develop" | "testing";
  case: string;
  rep: number;
  ok: boolean;
  error: string | null;
  retried429: boolean;
  latencyMs: number;
  finishReason: string | null;
  usage: { input: number | null; output: number | null; reasoning: number | null; total: number | null } | null;
  metrics: Record<string, unknown>;
  text: string;
}

async function phaseCalls() {
  const { generateText } = await import("ai");
  const { describeError, parseJson } = await import("../src/lib/ai/generate");
  const models = await import("../src/lib/ai/models");
  const { ORCHESTRATOR_INSTRUCTIONS, planSchema } = await import("../src/lib/engine/orchestrator");
  const { DEVELOP_INSTRUCTIONS, parseDevelopOutput } = await import("../src/lib/engine/develop");
  const { TESTING_INSTRUCTIONS } = await import("../src/lib/engine/testing");
  const { profileFor } = await import("../src/lib/engine/shared");
  const { runChecks } = await import("../src/lib/testing");
  const { parseAcceptance } = await import("../src/lib/testing/acceptance");
  const { describeCriterion } = await import("../src/lib/testing/acceptance-describe");

  const candidates = [models.LAGUNA, models.GROQ_GPT_OSS_20B, models.GROQ_GPT_OSS_120B, models.GEMINI_FLASH_LITE].filter(
    (m) => !ONLY || ONLY.includes(m.id),
  );
  for (const k of new Set(candidates.map((m) => m.envKey))) if (!process.env[k]) console.warn(`Aviso: falta ${k}`);

  // Mismos parámetros que el motor (generate.ts y cada agente).
  const ROLE = {
    orchestrator: { instructions: ORCHESTRATOR_INSTRUCTIONS, maxOutputTokens: 2048, timeout: 30_000 },
    develop: { instructions: DEVELOP_INSTRUCTIONS, maxOutputTokens: 8192, timeout: 45_000 },
    testing: { instructions: TESTING_INSTRUCTIONS, maxOutputTokens: 1024, timeout: 30_000 },
  } as const;
  const ESTIMATE = { orchestrator: 3_000, develop: 6_500, testing: 2_500 };
  const lastTotal = new Map<string, number>();

  // Informe real de Testing para la prueba C (mismo formato de prompt que testTask).
  const buggyReport = await runChecks([{ path: BUGGY_PATH, content: BUGGY_CODE }], { profile: "contact-form" });
  const testingPrompt = `Tarea: Formulario de contacto\n\nFallos detectados por los checks:\n${buggyReport.summary}\n\nCódigo:\n--- ${BUGGY_PATH} ---\n${BUGGY_CODE}`;

  // Prompt de Develop con el mismo formato que developTask (primer intento, sin dependencias).
  const developPrompt = (t: (typeof DEV_TASKS)[number]) => {
    const crit = parseAcceptance(t.acceptance).criteria;
    const lines = crit.map(
      (c) =>
        `- ${describeCriterion(c)}${
          c.type === "field" ? ` (input/textarea/select con name="${c.name}"${c.required ? " y el atributo required" : ""})` : ""
        }`,
    );
    return [
      `Petición original del usuario: ${t.request}`,
      `Tarea: ${t.title}\n${t.description}`,
      `Criterios de aceptación del Orquestador. Testing los comprobará automáticamente en el HTML que renderiza tu componente en su estado inicial (sin clics ni envíos); deben cumplirse todos:\n${lines.join("\n")}`,
    ].join("\n\n");
  };

  type Job = { test: CallRecord["test"]; case: string; prompt: string };
  const jobs: Job[] = [
    ...ORCH_REQUESTS.map((r) => ({ test: "orchestrator" as const, case: r.id, prompt: `Petición: ${r.request}` })),
    ...DEV_TASKS.map((t) => ({ test: "develop" as const, case: t.id, prompt: developPrompt(t) })),
    { test: "testing" as const, case: "2-fallos", prompt: testingPrompt },
  ];

  // Gemini: sonda con el prompt real del Orquestador; si no responde, se registra y no se sigue.
  const active = [...candidates];
  const records: CallRecord[] = [];

  async function call(spec: (typeof candidates)[number], job: Job, rep: number): Promise<CallRecord> {
    const role = ROLE[job.test];
    const key = `${spec.id}|${job.test}`;
    let retried429 = false;
    for (let attempt = 1; ; attempt++) {
      await pace(spec, lastTotal.get(key) ?? ESTIMATE[job.test]);
      const t0 = Date.now();
      try {
        const res = await generateText({
          model: models.getLanguageModel(spec),
          instructions: role.instructions,
          prompt: job.prompt,
          maxOutputTokens: role.maxOutputTokens,
          temperature: 0.2,
          maxRetries: 0,
          timeout: role.timeout,
        });
        const latencyMs = Date.now() - t0;
        const u = res.usage;
        const usage = {
          input: u?.inputTokens ?? null,
          output: u?.outputTokens ?? null,
          reasoning: u?.outputTokenDetails?.reasoningTokens ?? null,
          total: u?.totalTokens ?? null,
        };
        if (usage.total) {
          lastTotal.set(key, usage.total);
          spend(spec, usage.total);
        }
        const scored = await score(job, res.text);
        return {
          model: spec.id, test: job.test, case: job.case, rep, ok: scored.ok, error: null, retried429, latencyMs,
          finishReason: res.finishReason ?? null, usage, metrics: scored.metrics, text: res.text.slice(0, 12_000),
        };
      } catch (e) {
        const latencyMs = Date.now() - t0;
        const d = describeError(e);
        // Groq reserva tokens aunque falle: se apunta la estimación para no encadenar 429.
        spend(spec, Math.min(ESTIMATE[job.test], 2_000));
        if (d.status === 429 && attempt === 1) {
          console.log(`    429 en ${spec.label} (${job.test}/${job.case}); espero 60 s y repito una vez`);
          retried429 = true;
          await sleep(60_000);
          continue;
        }
        const reason = d.reason === "timeout" ? `timeout ${role.timeout / 1000} s` : d.reason;
        return {
          model: spec.id, test: job.test, case: job.case, rep, ok: false, error: reason, retried429, latencyMs,
          finishReason: null, usage: null, metrics: {}, text: "",
        };
      }
    }
  }

  async function score(job: Job, text: string): Promise<{ ok: boolean; metrics: Record<string, unknown> }> {
    if (job.test === "orchestrator") {
      const expect = ORCH_REQUESTS.find((r) => r.id === job.case)!.expect;
      let strictJson = true;
      try {
        JSON.parse(text.trim());
      } catch {
        strictJson = false;
      }
      let plan: { tasks: { title: string; description: string; acceptance?: unknown }[]; outOfScope?: string };
      try {
        plan = parseJson(planSchema, text);
      } catch (e) {
        return { ok: false, metrics: { schemaValid: false, strictJson, parseError: e instanceof Error ? e.message : "?" } };
      }
      let valid = 0;
      let discarded = 0;
      let raw = 0;
      const tasks = plan.tasks.map((t) => {
        const p = parseAcceptance(t.acceptance);
        valid += p.criteria.length;
        discarded += p.discarded;
        raw += Array.isArray(t.acceptance) ? t.acceptance.length : t.acceptance == null ? 0 : 1;
        return {
          title: t.title,
          profile: profileFor(t.title, t.description),
          criteria: p.criteria.length,
          discarded: p.discarded,
          types: p.criteria.map((c) => c.type),
        };
      });
      const decision = plan.tasks.length === 0 ? "out-of-scope" : "plan";
      const scopeOk = decision === expect;
      return {
        ok: scopeOk,
        metrics: {
          schemaValid: true,
          strictJson,
          decision,
          scopeOk,
          outOfScope: plan.outOfScope ?? null,
          tasks: plan.tasks.length,
          criteriaRaw: raw,
          criteriaValid: valid,
          criteriaDiscarded: discarded,
          tasksWithoutCriteria: tasks.filter((t) => t.criteria === 0).length,
          taskDetail: tasks,
        },
      };
    }
    if (job.test === "develop") {
      const task = DEV_TASKS.find((t) => t.id === job.case)!;
      const fileTags = /<file\s+path\s*=\s*"[^"]+"\s*>/.test(text);
      let files: { path: string; content: string }[];
      try {
        files = parseDevelopOutput(text).files;
      } catch (e) {
        return { ok: false, metrics: { formatOk: false, fileTags, parseError: e instanceof Error ? e.message : "?" } };
      }
      const profile = profileFor(task.title, task.description);
      const criteria = parseAcceptance(task.acceptance).criteria;
      const report = await runChecks(files, { profile, acceptance: criteria });
      const errors = report.failures.filter((f) => f.severity === "error");
      return {
        ok: report.passed,
        metrics: {
          formatOk: true,
          fileTags,
          profile,
          files: files.map((f) => f.path),
          checksPassed: report.passed,
          failedChecks: errors.map((f) => `${f.id}: ${f.message}`.slice(0, 180)),
          warnings: report.failures.filter((f) => f.severity !== "error").length,
          acceptance: report.acceptance
            ? { passed: report.acceptance.passed, total: report.acceptance.total, skipped: report.acceptance.skipped }
            : null,
        },
      };
    }
    const t = text.trim();
    const bugEmail = BUG_EMAIL.test(t);
    const bugAlt = BUG_ALT.test(t);
    return {
      ok: bugEmail && bugAlt,
      metrics: { bugEmail, bugAlt, lines: t.split(/\r?\n/).filter((l) => l.trim()).length, mentionsFile: /ContactForm\.tsx/.test(t) },
    };
  }

  const gemini = active.find((m) => m.provider === "google");
  if (gemini) {
    console.log("Sonda de gemini-3.1-flash-lite con el prompt real del Orquestador…");
    const probe = await call(gemini, jobs[0], 0);
    records.push({ ...probe, case: `sonda:${probe.case}` });
    console.log(`  sonda: ${probe.error ?? (probe.ok ? "ok" : "respuesta no válida")} (${(probe.latencyMs / 1000).toFixed(1)} s)`);
    if (probe.error) active.splice(active.indexOf(gemini), 1);
  }

  const total = REPS * jobs.length * active.length;
  let n = 0;
  // Orden: repetición -> prueba -> modelo, para alternar proveedores y separar en el tiempo las muestras.
  for (let rep = 1; rep <= REPS; rep++) {
    for (const job of jobs) {
      for (const spec of active) {
        n++;
        const r = await call(spec, job, rep);
        records.push(r);
        const m = r.metrics;
        const detail =
          r.test === "orchestrator"
            ? m.schemaValid
              ? `${m.decision}, ${m.tasks} tareas, criterios ${m.criteriaValid} válidos/${m.criteriaDiscarded} descartados${m.strictJson ? "" : ", JSON no estricto"}`
              : `JSON no válido (${m.parseError})`
            : r.test === "develop"
              ? m.formatOk
                ? `checks ${m.checksPassed ? "pasan" : "FALLAN"}${m.acceptance ? `, criterios ${(m.acceptance as { passed: number }).passed}/${(m.acceptance as { total: number }).total}` : ""}${(m.failedChecks as string[]).length ? ` [${(m.failedChecks as string[]).map((f) => f.split(":")[0]).join(", ")}]` : ""}`
                : `formato no válido (${m.parseError})`
              : `email:${m.bugEmail ? "sí" : "no"} alt:${m.bugAlt ? "sí" : "no"}, ${m.lines} líneas`;
        console.log(
          `[${n}/${total}] ${spec.label} · ${r.test}/${r.case} #${rep}: ${r.error ? `ERROR ${r.error}` : r.ok ? "ok" : "FALLO"} · ${(r.latencyMs / 1000).toFixed(1)} s · ${r.usage?.total ?? "-"} tok${r.usage?.reasoning ? ` (${r.usage.reasoning} razon.)` : ""}${r.finishReason && r.finishReason !== "stop" ? ` · fin=${r.finishReason}` : ""}${r.retried429 ? " · 429 y repetida" : ""}${r.error ? "" : ` · ${detail}`}`,
        );
      }
    }
  }

  const http = summarizeHttp(0);
  console.log("\nPeticiones HTTP por proveedor:", JSON.stringify(http));
  printSummary(records);
  save("calls", { reps: REPS, models: candidates.map((m) => m.id), active: active.map((m) => m.id), buggyReport: buggyReport.summary, http, records });
}

function summarizeHttp(since: number) {
  const out: Record<string, { requests: number; r429: number; other: Record<string, number> }> = {};
  for (const h of httpLog.filter((h) => h.at >= since)) {
    const o = (out[h.provider] ??= { requests: 0, r429: 0, other: {} });
    o.requests++;
    if (h.status === 429) o.r429++;
    else if (h.status >= 400) o.other[h.status] = (o.other[h.status] ?? 0) + 1;
  }
  return out;
}

function printSummary(records: CallRecord[]) {
  const models = [...new Set(records.map((r) => r.model))];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const f = (x: number | null, d = 1) => (x == null ? "-" : x.toFixed(d));
  console.log("\n| Modelo | Prueba | Aciertos | Errores | Latencia media (s) | Tokens medios (total / razonam.) |");
  console.log("|---|---|---|---|---|---|");
  for (const model of models) {
    for (const test of ["orchestrator", "develop", "testing"] as const) {
      const rs = records.filter((r) => r.model === model && r.test === test && !r.case.startsWith("sonda"));
      if (!rs.length) continue;
      const okRs = rs.filter((r) => !r.error);
      console.log(
        `| ${model} | ${test} | ${rs.filter((r) => r.ok).length}/${rs.length} | ${rs.length - okRs.length} | ${f(avg(okRs.map((r) => r.latencyMs / 1000)))} | ${f(avg(okRs.map((r) => r.usage?.total ?? 0)), 0)} / ${f(avg(okRs.map((r) => r.usage?.reasoning ?? 0)), 0)} |`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fase runs
// ---------------------------------------------------------------------------------------------
async function phaseRuns() {
  const models = await import("../src/lib/ai/models");
  const { asc, eq } = await import("drizzle-orm");
  const { db, runs, tasks, events } = await import("../src/db");
  const { advanceRun } = await import("../src/lib/engine");

  const pool = [models.LAGUNA, models.GROQ_GPT_OSS_20B, models.GROQ_GPT_OSS_120B];
  const primaries = pool.filter((m) => !ONLY || ONLY.includes(m.id));
  const requests = [`${RUN_MARK} Añade una página de contacto a esta web`, `${RUN_MARK} Crea una tabla de precios con tres planes`];
  const original = JSON.parse(JSON.stringify(models.ROLE_MODELS));
  const results: unknown[] = [];

  for (const primary of primaries) {
    const fallbacks = pool.filter((m) => m !== primary);
    // SOLO en memoria de este proceso: el código y el despliegue no cambian.
    for (const role of ["orchestrator", "develop", "testing"] as const) {
      models.ROLE_MODELS[role] = { primary, fallbacks };
    }
    for (const request of requests) {
      // Ventana de tokens de Groq limpia antes de cada run.
      console.log(`\nPausa de 65 s antes del run (límite de tokens/min de Groq)…`);
      await sleep(65_000);
      const since = Date.now();
      const [run] = await db.insert(runs).values({ request, status: "running", engineManaged: true }).returning();
      await db.insert(events).values({ runId: run.id, agent: "orchestrator", message: "Petición recibida" });
      console.log(`Run #${run.id} · principal ${primary.label} · respaldos ${fallbacks.map((m) => m.label).join(" → ")} · "${request}"`);
      const t0 = Date.now();
      let step = 0;
      let lastEventId = 0;
      for (; step < 40 && Date.now() - t0 < 20 * 60_000; step++) {
        const r = await advanceRun(run.id);
        const fresh = await db.select().from(events).where(eq(events.runId, run.id)).orderBy(asc(events.id));
        for (const e of fresh.filter((e) => e.id > lastEventId)) console.log(`  [${e.agent}] ${e.message}`);
        lastEventId = fresh.at(-1)?.id ?? lastEventId;
        if (!r.more) break;
        if (r.outcome === "busy" || r.outcome === "error") await sleep(3_000);
      }
      const totalMs = Date.now() - t0;
      const [final] = await db.select().from(runs).where(eq(runs.id, run.id));
      const taskRows = await db.select().from(tasks).where(eq(tasks.runId, run.id)).orderBy(asc(tasks.id));
      const evs = await db.select().from(events).where(eq(events.runId, run.id)).orderBy(asc(events.id));
      const jumps = evs.filter((e) => /falla \(.*\); uso .* como respaldo/.test(e.message));
      const stepFails = evs.filter((e) => /^Paso fallido|^Run detenido/.test(e.message));
      const http = summarizeHttp(since);
      const out = {
        runId: run.id,
        primary: primary.id,
        fallbacks: fallbacks.map((m) => m.id),
        request,
        status: final.status,
        totalMs,
        steps: step + 1,
        tasks: taskRows.map((t) => ({
          title: t.title,
          status: t.status,
          attempts: t.attempts,
          profile: t.checkProfile,
          criteria: (t.acceptance ?? []).map((c) => `${c.type}:${c.status ?? "-"}`),
        })),
        fallbackJumps: jumps.length,
        jumpDetail: jumps.map((e) => `[${e.agent}] ${e.message}`),
        stepFailures: stepFails.map((e) => e.message.slice(0, 300)),
        http,
        r429: Object.values(http).reduce((a, h) => a + h.r429, 0),
        events: evs.map((e) => `[${e.agent}] ${e.message}`),
      };
      results.push(out);
      console.log(
        `=> ${final.status} · ${(totalMs / 1000).toFixed(1)} s · tareas ${taskRows.map((t) => `${t.status}/${t.attempts}`).join(", ")} · saltos ${jumps.length} · 429 ${out.r429} · http ${JSON.stringify(http)}`,
      );
    }
  }
  for (const role of ["orchestrator", "develop", "testing"] as const) models.ROLE_MODELS[role] = original[role];
  save("runs", results);
}

// ---------------------------------------------------------------------------------------------
// Fase cleanup
// ---------------------------------------------------------------------------------------------
async function phaseCleanup() {
  const { asc, like } = await import("drizzle-orm");
  const { db, runs } = await import("../src/db");
  const deleted = await db.delete(runs).where(like(runs.request, `${RUN_MARK}%`)).returning({ id: runs.id });
  console.log(`Borrados ${deleted.length} runs «${RUN_MARK}»: ${deleted.map((r) => r.id).join(", ") || "ninguno"}`);
  const left = await db.select({ id: runs.id, status: runs.status }).from(runs).orderBy(asc(runs.id));
  console.log(`Runs que quedan: ${left.map((r) => `${r.id} (${r.status})`).join(", ")}`);
  const expected = [2, 3, 7, 10, 18, 19];
  const missing = expected.filter((id) => !left.some((r) => r.id === id));
  console.log(missing.length ? `FALTAN runs esperados: ${missing.join(", ")}` : `Están los runs esperados: ${expected.join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// Fase selftest (sin red): los datos fijos dan lo que se espera.
// ---------------------------------------------------------------------------------------------
async function phaseSelftest() {
  const { runChecks } = await import("../src/lib/testing");
  const { parseAcceptance } = await import("../src/lib/testing/acceptance");
  const { profileFor } = await import("../src/lib/engine/shared");
  const r = await runChecks([{ path: BUGGY_PATH, content: BUGGY_CODE }], { profile: "contact-form" });
  console.log("Informe de la prueba C (debe tener exactamente 2 errores):\n" + r.summary);
  console.log(`errores: ${r.failures.filter((f) => f.severity === "error").length}`);
  for (const t of DEV_TASKS) {
    const p = parseAcceptance(t.acceptance);
    console.log(`Tarea ${t.id}: perfil ${profileFor(t.title, t.description)}, criterios válidos ${p.criteria.length}, descartados ${p.discarded}`);
  }
  const good = "Cambia el input de email a type=\"email\" y añade alt a la imagen.";
  console.log(`heurística: email ${BUG_EMAIL.test(good)}, alt ${BUG_ALT.test(good)}; vacío: ${BUG_EMAIL.test("x")}/${BUG_ALT.test("salto")}`);
  console.log(`límite Groq usado para el ritmo: ${GROQ_BUDGET} de ${GROQ_TPM} tokens/min`);
}

const PHASES: Record<string, () => Promise<void>> = {
  selftest: phaseSelftest,
  calls: phaseCalls,
  runs: phaseRuns,
  cleanup: phaseCleanup,
};

(PHASES[PHASE] ?? (async () => console.error(`Fase desconocida: ${PHASE}`)))()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error:", e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "desconocido");
    process.exit(1);
  });
