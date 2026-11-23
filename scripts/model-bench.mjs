// Benchmark de modelos para los 3 agentes (Orquestador, Develop, Testing).
// Uso: node scripts/model-bench.mjs [--only=id1,id2]
// Lee NVIDIA_API_KEY y GOOGLE_GENERATIVE_AI_API_KEY de .env.local. No imprime claves.
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

dotenv.config({ path: ".env.local", quiet: true });
const require = createRequire(import.meta.url);
const ts = require("typescript");

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const TIMEOUT_MS = 90_000;
const PAUSE_MS = 3_000; // ~20 peticiones/min, por debajo del límite de ~40/min
const TMP = path.resolve("scripts/.tmp");

const MODELS = [
  { id: "moonshotai/kimi-k3.1-pro", provider: "nvidia" },
  { id: "mistralai/mistral-large-4-1t-a52b", provider: "nvidia" },
  { id: "z-ai/glm-5.3-flash", provider: "nvidia" },
  { id: "poolside/laguna-xs-2.1", provider: "nvidia" },
  { id: "minimaxai/minimax-m3.1-flash", provider: "nvidia" },
  // gemini-2.5-flash devuelve 404 ("no longer available to new users") con esta clave
  { id: "gemini-3.5-flash", provider: "google" },
  { id: "gemini-3.1-flash-lite", provider: "google" },
];

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Llamada a modelos ----------
async function callOnce(model, prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    let res;
    if (model.provider === "nvidia") {
      res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096,
          temperature: 0.2,
        }),
      });
    } else {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GOOGLE_GENERATIVE_AI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
          }),
        },
      );
    }
    const raw = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, error: `HTTP ${res.status}: ${raw.slice(0, 160).replace(/\s+/g, " ")}` };
    const j = JSON.parse(raw);
    if (model.provider === "nvidia") {
      return {
        ok: true,
        ms,
        text: j.choices?.[0]?.message?.content ?? "",
        tokens: j.usage?.completion_tokens ?? null,
      };
    }
    return {
      ok: true,
      ms,
      text: j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
      tokens: j.usageMetadata?.candidatesTokenCount ?? null,
    };
  } catch (e) {
    const ms = Date.now() - t0;
    const timeout = e?.name === "AbortError";
    return { ok: false, ms, status: timeout ? "timeout" : "net", error: timeout ? "timeout 90s" : String(e?.message ?? e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

// Reintenta con backoff ante 429; 1 reintento ante fallo transitorio (timeout/red/5xx).
async function call(model, prompt, stats) {
  let attempt = 0;
  let transientRetried = false;
  for (;;) {
    const r = await callOnce(model, prompt);
    if (r.ok) return r;
    stats.errors.push(String(r.status));
    if (r.status === 429 && attempt < 4) {
      const wait = 5000 * 2 ** attempt++;
      await sleep(wait);
      continue;
    }
    if (!transientRetried && (r.status === "timeout" || r.status === "net" || r.status >= 500)) {
      transientRetried = true;
      await sleep(PAUSE_MS);
      continue;
    }
    return r;
  }
}

// ---------- Prompts ----------
const P_ORCH = `Eres el agente Orquestador de un equipo de desarrollo. Divide la siguiente petición en entre 3 y 5 tareas.
Petición: "Añade una página de contacto a esta web"
Responde SOLO con JSON válido, sin texto adicional ni bloques markdown, con la forma:
{"tasks":[{"title":"...","description":"..."}]}`;

const P_DEV = `Genera una página de contacto como UN ÚNICO componente React en TypeScript (TSX), con export default.
Requisitos: formulario con nombre, email y mensaje; validación en cliente con mensajes de error; accesibilidad (labels asociados, atributos aria); manejo de submit con estado de éxito. Sin dependencias externas salvo react.
Devuelve SOLO el código en un bloque \`\`\`tsx.`;

const BUGGY = `function paginate(items, page, size) {
  // page empieza en 1
  const start = page * size;
  return items.slice(start, start + size);
}

async function loadUser(id) {
  const res = fetch("/api/users/" + id);
  return res.json();
}

// tests
test("paginate página 1 devuelve los 2 primeros", () => {
  expect(paginate([1,2,3,4,5], 1, 2)).toEqual([1,2]);
});
test("loadUser devuelve el usuario", async () => {
  expect(await loadUser(7)).toEqual({ id: 7 });
});`;
const FAIL_OUT = `FAIL paginate página 1 devuelve los 2 primeros
  Expected: [1,2]  Received: [3,4]
FAIL loadUser devuelve el usuario
  TypeError: res.json is not a function`;
const P_TEST = `Eres el agente de Testing. Dado este código y la salida de los tests, resume en pocas líneas qué falla y por qué (causa raíz de cada fallo).

CÓDIGO:
${BUGGY}

SALIDA:
${FAIL_OUT}`;

// ---------- Evaluación ----------
function stripFences(t) {
  const m = t.match(/```(?:tsx|typescript|ts|jsx|js)?\s*\n([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function evalOrch(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
    if (!obj) return { jsonValid: false, sensible: false, strict: false, n: 0 };
    // válido pero con texto/markdown alrededor: no cumple "SOLO JSON"
    return { ...scoreTasks(obj), strict: false };
  }
  return { ...scoreTasks(obj), strict: true };
}
function scoreTasks(obj) {
  const tasks = Array.isArray(obj) ? obj : obj?.tasks;
  if (!Array.isArray(tasks)) return { jsonValid: true, sensible: false, n: 0 };
  const shapeOk = tasks.every((t) => typeof t?.title === "string" && t.title.trim() && typeof t?.description === "string" && t.description.trim());
  const blob = JSON.stringify(tasks).toLowerCase();
  const topical = /contact|formulario|form|email|correo/.test(blob);
  return { jsonValid: true, sensible: shapeOk && tasks.length >= 3 && tasks.length <= 5 && topical, n: tasks.length };
}

function compileTsx(code, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `${name}.tsx`);
  fs.writeFileSync(file, code);
  const program = ts.createProgram([file], {
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    esModuleInterop: true,
    types: ["react", "react-dom"],
  });
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === file && d.category === ts.DiagnosticCategory.Error);
  return {
    compiles: diags.length === 0,
    firstError: diags[0] ? ts.flattenDiagnosticMessageText(diags[0].messageText, " ").slice(0, 140) : null,
    errorCount: diags.length,
  };
}

function countChecks(code) {
  const ids = [...code.matchAll(/<(?:input|textarea)\b[^>]*\bid=\{?["'`]([^"'`}]+)/g)].map((m) => m[1]);
  const htmlFors = [...code.matchAll(/htmlFor=\{?["'`]([^"'`}]+)/g)].map((m) => m[1]);
  const labelsLinked = ids.length >= 3 && ids.every((i) => htmlFors.includes(i));
  const c = {
    labelsLinked, // 3 campos con label asociado
    required: /\brequired\b|aria-required/.test(code),
    ariaInvalid: /aria-invalid/.test(code),
    ariaDescribedby: /aria-describedby/.test(code),
    liveRegion: /role=["']alert["']|role=["']status["']|aria-live/.test(code),
    onSubmit: /onSubmit/.test(code),
    preventDefault: /preventDefault\(\)/.test(code),
    emailValidation: /(\.test\(|includes\(["']@["']\)|@.*\.)/.test(code) && /email/i.test(code),
    successState: /(sent|success|submitted|enviado|gracias)/i.test(code),
  };
  return { checks: c, score: Object.values(c).filter(Boolean).length, total: Object.keys(c).length };
}

function evalTest(text) {
  const t = text.toLowerCase();
  const bug1 = /(page\s*-\s*1|1-based|base 1|off-by-one|índice|indice|empieza en 1|starts? at 1|\(page - 1\)|desplaz|offset)/.test(t);
  const bug2 = /(await|promesa|promise)/.test(t);
  return { bug1, bug2, both: bug1 && bug2 };
}

// ---------- Ejecución ----------
async function listNvidia() {
  const r = await fetch(`${NVIDIA_BASE}/models`, { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` } });
  const j = await r.json();
  return (j.data ?? []).map((m) => m.id);
}

async function main() {
  const available = await listNvidia();
  console.log(`Modelos NVIDIA disponibles: ${available.length}`);
  const results = [];
  for (const model of MODELS.filter((m) => !only || only.includes(m.id))) {
    if (model.provider === "nvidia" && !available.includes(model.id)) {
      console.log(`- ${model.id}: no aparece en /models, se omite`);
      results.push({ model: model.id, skipped: true });
      continue;
    }
    console.log(`\n== ${model.id}`);
    const stats = { errors: [] };
    const res = { model: model.id, latencies: [] };
    const slug = model.id.replace(/[^a-z0-9]+/gi, "_");

    const o = await call(model, P_ORCH, stats);
    await sleep(PAUSE_MS);
    if (o.ok) { res.latencies.push(o.ms); res.orch = { ms: o.ms, ...evalOrch(o.text) }; } else res.orch = { error: o.error };
    console.log("  orquestador:", o.ok ? "ok" : o.error);
    if (!o.ok && o.status === "timeout") {
      // No responde ni tras reintento: se omiten el resto de pruebas para no bloquear el benchmark.
      res.errors = stats.errors; res.unresponsive = true; results.push(res);
      console.log("  sin respuesta, se omite el resto");
      continue;
    }

    const d = await call(model, P_DEV, stats);
    await sleep(PAUSE_MS);
    if (d.ok) {
      res.latencies.push(d.ms);
      const code = stripFences(d.text);
      res.dev = { ms: d.ms, tokens: d.tokens, chars: code.length, ...compileTsx(code, slug), ...countChecks(code) };
    } else res.dev = { error: d.error };

    const t = await call(model, P_TEST, stats);
    await sleep(PAUSE_MS);
    if (t.ok) { res.latencies.push(t.ms); res.test = { ms: t.ms, tokens: t.tokens, ...evalTest(t.text) }; } else res.test = { error: t.error };

    res.avgMs = res.latencies.length ? Math.round(res.latencies.reduce((a, b) => a + b, 0) / res.latencies.length) : null;
    res.errors = stats.errors;
    results.push(res);
    console.log(JSON.stringify({ ...res, dev: res.dev && { ...res.dev, checks: undefined } }));
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, "results.partial.json"), JSON.stringify(results, null, 2));
  }
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, "results.json"), JSON.stringify(results, null, 2));
  console.log("\nResultados guardados en scripts/.tmp/results.json");
}

main().catch((e) => {
  console.error("Error:", String(e?.message ?? e).slice(0, 200));
  process.exit(1);
});
