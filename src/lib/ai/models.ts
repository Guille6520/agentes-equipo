// Modelos por agente y respaldo cruzado entre proveedores (ver docs/model-comparison.md).
// Las claves se leen solo de process.env en el momento de la llamada y nunca se imprimen.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type Role = "orchestrator" | "develop" | "testing";

export interface ModelSpec {
  provider: "google" | "nvidia";
  id: string;
  /** Nombre corto para los eventos de la UI. */
  label: string;
  envKey: "GOOGLE_GENERATIVE_AI_API_KEY" | "NVIDIA_API_KEY";
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

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** Primario y respaldo por rol: cada proveedor cubre al otro. */
export const ROLE_MODELS: Record<Role, { primary: ModelSpec; fallback: ModelSpec }> = {
  orchestrator: { primary: GEMINI_FLASH_LITE, fallback: LAGUNA },
  develop: { primary: LAGUNA, fallback: GEMINI_FLASH_LITE },
  testing: { primary: GEMINI_FLASH_LITE, fallback: LAGUNA },
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
  return createOpenAICompatible({ name: "nvidia", baseURL: NVIDIA_BASE_URL, apiKey })(spec.id);
}
