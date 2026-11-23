// Modelos por agente y cadena de respaldo entre proveedores (ver docs/seleccion-de-modelos.md).
// Las claves se leen solo de process.env en el momento de la llamada y nunca se imprimen.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type Role = "orchestrator" | "develop" | "testing";

export type Provider = "google" | "nvidia" | "groq";

export interface ModelSpec {
  provider: Provider;
  id: string;
  /** Nombre corto para los eventos de la UI. */
  label: string;
  envKey: "GOOGLE_GENERATIVE_AI_API_KEY" | "NVIDIA_API_KEY" | "GROQ_API_KEY";
}

export const GEMINI_FLASH_LITE: ModelSpec = {
  provider: "google",
  id: "gemini-3.1-flash-lite",
  label: "gemini-3.1-flash-lite",
  envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
};

export const LAGUNA: ModelSpec = {
  provider: "nvidia",
  id: "poolside/laguna-xs-2.1",
  label: "laguna-xs-2.1",
  envKey: "NVIDIA_API_KEY",
};

/** Candidatos de Groq (plan gratuito). El elegido para la cadena de respaldo es GROQ_FALLBACK. */
export const GROQ_GPT_OSS_120B: ModelSpec = {
  provider: "groq",
  id: "openai/gpt-oss-120b",
  label: "gpt-oss-120b",
  envKey: "GROQ_API_KEY",
};

export const GROQ_GPT_OSS_20B: ModelSpec = {
  provider: "groq",
  id: "openai/gpt-oss-20b",
  label: "gpt-oss-20b",
  envKey: "GROQ_API_KEY",
};

export const GROQ_QWEN: ModelSpec = {
  provider: "groq",
  id: "qwen/qwen3.8-27b",
  label: "qwen3.8-27b",
  envKey: "GROQ_API_KEY",
};

export const GROQ_CANDIDATES: ModelSpec[] = [GROQ_GPT_OSS_120B, GROQ_GPT_OSS_20B, GROQ_QWEN];

/** Modelo de Groq elegido con scripts/bench-groq.ts (ver docs/seleccion-de-modelos.md). */
export const GROQ_FALLBACK: ModelSpec = GROQ_GPT_OSS_20B;

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface RoleChain {
  primary: ModelSpec;
  /** Respaldos en orden: si el primario falla se prueba cada uno con un único intento. */
  fallbacks: ModelSpec[];
}

/**
 * Cadena por rol, decidida con el benchmark de los prompts reales del motor (docs/seguimiento-del-prompt.md):
 * - gpt-oss-20b (Groq) es el principal: fue el único que acertó todas las pruebas y el más rápido.
 * - Laguna (NVIDIA) es el primer respaldo: está en otro proveedor, así que cubre un 429 o una caída de Groq.
 * - gpt-oss-120b (Groq) es el último: comparte proveedor con el principal y compiló peor en Develop.
 * Gemini queda fuera mientras devuelva 503 de forma repetida (se sigue midiendo en /evals).
 */
export const ROLE_MODELS: Record<Role, RoleChain> = {
  orchestrator: { primary: GROQ_GPT_OSS_20B, fallbacks: [LAGUNA, GROQ_GPT_OSS_120B] },
  develop: { primary: GROQ_GPT_OSS_20B, fallbacks: [LAGUNA, GROQ_GPT_OSS_120B] },
  testing: { primary: GROQ_GPT_OSS_20B, fallbacks: [LAGUNA, GROQ_GPT_OSS_120B] },
};

export class MissingKeyError extends Error {
  constructor(envKey: string) {
    super(`falta la variable ${envKey}`);
    this.name = "MissingKeyError";
  }
}

/** Crea el modelo del SDK. Lanza MissingKeyError si falta la clave (se trata como fallo del proveedor). */
export function getLanguageModel(spec: ModelSpec): LanguageModel {
  const apiKey = process.env[spec.envKey];
  if (!apiKey) throw new MissingKeyError(spec.envKey);
  if (spec.provider === "google") return createGoogleGenerativeAI({ apiKey })(spec.id);
  if (spec.provider === "groq") return createOpenAICompatible({ name: "groq", baseURL: GROQ_BASE_URL, apiKey })(spec.id);
  return createOpenAICompatible({ name: "nvidia", baseURL: NVIDIA_BASE_URL, apiKey })(spec.id);
}
