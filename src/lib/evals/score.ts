// Puntuación de las respuestas. Orquestador y Testing: heurísticas del script model-bench.mjs.
// Develop: checks deterministas de src/lib/testing (perfil contact-form).
import { runChecks } from "@/lib/testing";
import type { EvalMetrics } from "./types";

export function stripFences(t: string): string {
  const m = t.match(/```(?:tsx|typescript|ts|jsx|js)?\s*\n([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

function scoreTasks(obj: unknown): { jsonValid: boolean; sensible: boolean; tasks: number } {
  const tasks = Array.isArray(obj) ? obj : (obj as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks)) return { jsonValid: true, sensible: false, tasks: 0 };
  const shapeOk = tasks.every(
    (t) =>
      typeof t?.title === "string" && t.title.trim() && typeof t?.description === "string" && t.description.trim(),
  );
  const blob = JSON.stringify(tasks).toLowerCase();
  const topical = /contact|formulario|form|email|correo/.test(blob);
  return { jsonValid: true, sensible: Boolean(shapeOk) && tasks.length >= 3 && tasks.length <= 5 && topical, tasks: tasks.length };
}

export function scoreOrchestrator(text: string): { ok: boolean; metrics: EvalMetrics } {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let obj: unknown;
  let strictJson = true;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    strictJson = false;
    const m = cleaned.match(/\{[\s\S]*\}/);
    try {
      obj = m ? JSON.parse(m[0]) : null;
    } catch {
      obj = null;
    }
    if (!obj) return { ok: false, metrics: { jsonValid: false, sensible: false, strictJson: false, tasks: 0 } };
  }
  const s = scoreTasks(obj);
  return { ok: s.jsonValid && s.sensible, metrics: { ...s, strictJson } };
}

export function scoreTesting(text: string): { ok: boolean; metrics: EvalMetrics } {
  const t = text.toLowerCase();
  const bug1 = /(page\s*-\s*1|1-based|base 1|off-by-one|índice|indice|empieza en 1|starts? at 1|\(page - 1\)|desplaz|offset)/.test(t);
  const bug2 = /(await|promesa|promise)/.test(t);
  return { ok: bug1 && bug2, metrics: { bug1, bug2, both: bug1 && bug2 } };
}

export async function scoreDevelop(text: string): Promise<{ ok: boolean; metrics: EvalMetrics }> {
  const code = stripFences(text);
  const report = await runChecks([{ path: "components/ContactPage.tsx", content: code }], { profile: "contact-form" });
  const checksTotal = report.results.length;
  const checksPassed = report.results.filter((r) => r.passed).length;
  const compiles = !report.results.some((r) => r.id.startsWith("syntax") && !r.passed && r.severity === "error");
  return {
    ok: compiles,
    metrics: {
      compiles,
      checksPassed,
      checksTotal,
      failedChecks: report.failures.slice(0, 6).map((f) => `${f.name}: ${f.message}`.slice(0, 140)),
    },
  };
}
