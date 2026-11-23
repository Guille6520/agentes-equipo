// Catálogo de la evaluación: los modelos de los benchmarks manuales y los 3 finalistas relanzables.
import { GEMINI_FLASH_LITE, GROQ_FALLBACK, LAGUNA, type ModelSpec, type Provider } from "@/lib/ai/models";

export const EVAL_TESTS = ["orchestrator", "develop", "testing"] as const;
export type EvalTest = (typeof EVAL_TESTS)[number];

export const TEST_LABEL: Record<EvalTest, string> = {
  orchestrator: "Orquestador",
  develop: "Develop",
  testing: "Testing",
};

export const MANUAL_ORIGIN = "manual-2026-11-23";
/** Benchmark de los candidatos de Groq (scripts/bench-groq.ts). */
export const MANUAL_GROQ_ORIGIN = "manual-groq-2026-11-23";
/** Evaluaciones históricas cargadas con scripts/seed-evals.ts (todas empiezan por "manual"). */
export const MANUAL_ORIGINS = [MANUAL_ORIGIN, MANUAL_GROQ_ORIGIN];
export const APP_ORIGIN = "app";

/** Mínimo entre dos evaluaciones nuevas lanzadas desde la app. */
export const COOLDOWN_SECONDS = 600;
/** Una evaluación "en curso" sin terminar pasados estos minutos se considera abandonada. */
export const STALE_RUN_MINUTES = 15;

export interface EvalModelInfo {
  id: string;
  provider: Provider;
  label: string;
  finalist: boolean;
}

export const EVAL_MODELS: EvalModelInfo[] = [
  { id: "poolside/laguna-xs-2.1", provider: "nvidia", label: "laguna-xs-2.1", finalist: true },
  { id: "gemini-3.1-flash-lite", provider: "google", label: "gemini-3.1-flash-lite", finalist: true },
  { id: "openai/gpt-oss-20b", provider: "groq", label: "gpt-oss-20b", finalist: true },
  { id: "gemini-3.5-flash", provider: "google", label: "gemini-3.5-flash", finalist: false },
  { id: "mistralai/mistral-large-4-1t-a52b", provider: "nvidia", label: "mistral-large-4-1t-a52b", finalist: false },
  { id: "minimaxai/minimax-m3.1-flash", provider: "nvidia", label: "minimax-m3.1-flash", finalist: false },
  { id: "moonshotai/kimi-k3.1-pro", provider: "nvidia", label: "kimi-k3.1-pro", finalist: false },
  { id: "z-ai/glm-5.3-flash", provider: "nvidia", label: "glm-5.3-flash", finalist: false },
  { id: "gemini-2.5-flash", provider: "google", label: "gemini-2.5-flash", finalist: false },
  { id: "openai/gpt-oss-120b", provider: "groq", label: "gpt-oss-120b", finalist: false },
  { id: "qwen/qwen3.8-27b", provider: "groq", label: "qwen3.8-27b", finalist: false },
];

/** Solo estos tres modelos (la cadena de los agentes) se pueden relanzar (cuota gratuita). */
export const FINALISTS: ModelSpec[] = [LAGUNA, GEMINI_FLASH_LITE, GROQ_FALLBACK];

export interface StepPlan {
  step: number;
  model: ModelSpec;
  test: EvalTest;
}

/** 9 pasos: cada finalista con las 3 pruebas, en orden. */
export const STEP_PLAN: StepPlan[] = FINALISTS.flatMap((model, m) =>
  EVAL_TESTS.map((test, t) => ({ step: m * EVAL_TESTS.length + t, model, test })),
);
