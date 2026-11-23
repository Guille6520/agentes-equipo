// Ejecuta UNA prueba de UN modelo. A diferencia de callModel (src/lib/ai/generate.ts) NO hay
// reintentos ni respaldo entre proveedores: aquí se mide cada modelo por separado y, si falla,
// el fallo se registra como error (solo etiqueta corta, nunca cuerpos de respuesta ni claves).
import { generateText } from "ai";
import { describeError } from "@/lib/ai/generate";
import { getLanguageModel, type ModelSpec } from "@/lib/ai/models";
import type { EvalTest } from "./models";
import { P_DEV, P_ORCH, P_TEST } from "./prompts";
import { scoreDevelop, scoreOrchestrator, scoreTesting } from "./score";
import type { EvalMetrics } from "./types";

/** Tope por llamada: un paso entero debe caber en maxDuration (60 s) con los checks de Develop. */
export const EVAL_TIMEOUT_MS = 45_000;

const PROMPTS: Record<EvalTest, string> = { orchestrator: P_ORCH, develop: P_DEV, testing: P_TEST };

export interface StepOutcome {
  ok: boolean | null;
  metrics: EvalMetrics | null;
  error: string | null;
}

export async function runEvalStep(spec: ModelSpec, test: EvalTest): Promise<StepOutcome> {
  const t0 = Date.now();
  let text: string;
  let tokens: number | null = null;
  try {
    const res = await generateText({
      model: getLanguageModel(spec),
      prompt: PROMPTS[test],
      maxOutputTokens: spec.provider === "google" ? 8192 : 4096,
      temperature: 0.2,
      maxRetries: 0,
      timeout: EVAL_TIMEOUT_MS,
    });
    text = res.text;
    tokens = res.usage?.outputTokens ?? null;
  } catch (e) {
    const d = describeError(e);
    // describeError usa el timeout de generate.ts (60 s); aquí el real es EVAL_TIMEOUT_MS.
    const reason = /^timeout/.test(d.reason) ? `timeout ${EVAL_TIMEOUT_MS / 1000} s` : d.reason;
    return { ok: false, metrics: { latencyMs: Date.now() - t0 }, error: reason };
  }
  const latencyMs = Date.now() - t0;

  try {
    const scored =
      test === "orchestrator" ? scoreOrchestrator(text) : test === "develop" ? await scoreDevelop(text) : scoreTesting(text);
    return { ok: scored.ok, metrics: { ...scored.metrics, latencyMs, tokens }, error: null };
  } catch (e) {
    return { ok: false, metrics: { latencyMs, tokens }, error: `error al puntuar (${e instanceof Error ? e.name : "desconocido"})` };
  }
}
