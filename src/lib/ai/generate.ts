// Llamada a un modelo con timeout, un reintento con backoff y una cadena de respaldos entre proveedores.
//
// Política por llamada lógica (peor caso ~(2 + nº de respaldos) x timeout del rol + backoff):
//   1. Modelo primario.
//   2. Si el fallo es transitorio (timeout, red, 429, 5xx o salida inválida): espera y reintenta una vez.
//   3. Si sigue fallando (o el fallo no es transitorio: 401/404, falta la clave): cada respaldo de la
//      cadena, en orden, con un único intento. Cada salto se avisa con `onFallback` (de qué modelo a
//      qué modelo) para registrar un evento. Un respaldo sin clave falla al instante y se pasa al siguiente.
// Los mensajes de error solo llevan códigos/etiquetas cortas: nunca cuerpos de respuesta ni claves.
import { APICallError, generateText } from "ai";
import type { z } from "zod";
import { getLanguageModel, MissingKeyError, ROLE_MODELS, type ModelSpec, type Role, type RoleChain } from "./models";

// Timeout por llamada y rol: corto para que el respaldo entre pronto si un proveedor se queda colgado.
// Develop escribe más código y necesita algo más de margen (Laguna tarda ~15-20 s).
const TIMEOUT_BY_ROLE_MS: Record<Role, number> = {
  orchestrator: 30_000,
  develop: 45_000,
  testing: 30_000,
};
const BACKOFF_MS = 2_000;
const BACKOFF_429_MS = 6_000;

export interface CallOptions<T> {
  role: Role;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Convierte el texto en el resultado; si lanza, la salida cuenta como inválida (y se reintenta). */
  parse: (text: string) => T;
  /** Se llama en cada salto de la cadena: cuando un modelo se da por perdido y se pasa al siguiente. */
  onFallback?: (info: { from: ModelSpec; to: ModelSpec; reason: string }) => Promise<void> | void;
}

export interface CallResult<T> {
  data: T;
  model: ModelSpec;
  usedFallback: boolean;
  ms: number;
}

export class AllModelsFailedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Ningún modelo respondió: ${reasons.join("; ")}`);
    this.name = "AllModelsFailedError";
  }
}

class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOutputError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Etiqueta corta y segura del error + si merece reintento con el mismo modelo. */
export function describeError(e: unknown): { reason: string; retryable: boolean; status?: number } {
  if (e instanceof MissingKeyError) return { reason: e.message, retryable: false };
  if (e instanceof InvalidOutputError) return { reason: `salida no válida (${e.message})`, retryable: true };
  if (APICallError.isInstance(e)) {
    const status = e.statusCode;
    if (status === 429) return { reason: "HTTP 429 (cuota/limite)", retryable: true, status };
    if (status && status >= 500) return { reason: `HTTP ${status}`, retryable: true, status };
    if (status) return { reason: `HTTP ${status}`, retryable: false, status };
    return { reason: "error de red", retryable: true };
  }
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|abort/i.test(name) || /timed? ?out|aborted/i.test(msg)) {
    return { reason: "timeout", retryable: true };
  }
  // Errores con causa APICallError (p. ej. RetryError) o desconocidos: se reintentan una vez.
  const cause = (e as { cause?: unknown })?.cause;
  if (cause && cause !== e) return describeError(cause);
  return { reason: name || "error desconocido", retryable: true };
}

async function callOnce<T>(spec: ModelSpec, opts: CallOptions<T>): Promise<T> {
  const { text } = await generateText({
    model: getLanguageModel(spec),
    instructions: opts.instructions,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
    maxRetries: 0, // los reintentos los gestiona esta capa
    timeout: TIMEOUT_BY_ROLE_MS[opts.role],
  });
  try {
    return opts.parse(text);
  } catch (e) {
    throw new InvalidOutputError(e instanceof Error ? e.message.slice(0, 160) : "no se pudo interpretar");
  }
}

export interface ChainStep {
  spec: ModelSpec;
  /** Intentos con este modelo: 2 el primario (intento + reintento si el fallo es transitorio), 1 cada respaldo. */
  maxAttempts: number;
}

/** Orden de candidatos de una cadena (función pura, sin red). */
export function chainSteps(chain: RoleChain): ChainStep[] {
  return [{ spec: chain.primary, maxAttempts: 2 }, ...chain.fallbacks.map((spec) => ({ spec, maxAttempts: 1 }))];
}

export interface RunChainDeps<T> {
  attempt: (spec: ModelSpec) => Promise<T>;
  onFallback?: CallOptions<T>["onFallback"];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Recorre la cadena: cada modelo con sus intentos y, si se agota, salta al siguiente avisando con
 * onFallback. Separada de la red para poder probarla con un `attempt` simulado.
 */
export async function runChain<T>(chain: RoleChain, deps: RunChainDeps<T>): Promise<CallResult<T>> {
  const wait = deps.sleep ?? sleep;
  const now = deps.now ?? Date.now;
  const steps = chainSteps(chain);
  const reasons: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const { spec, maxAttempts } = steps[i];
    const t0 = now();
    let lastReason = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await deps.attempt(spec);
        return { data, model: spec, usedFallback: i > 0, ms: now() - t0 };
      } catch (e) {
        const d = describeError(e);
        reasons.push(`${spec.label}: ${d.reason}`);
        lastReason = attempt > 1 ? `${d.reason}, tras reintento` : d.reason;
        if (!d.retryable || attempt === maxAttempts) break;
        await wait(d.status === 429 ? BACKOFF_429_MS : BACKOFF_MS);
      }
    }
    const next = steps[i + 1];
    if (next) await deps.onFallback?.({ from: spec, to: next.spec, reason: lastReason });
  }
  throw new AllModelsFailedError(reasons);
}

export async function callModel<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  return runChain(ROLE_MODELS[opts.role], {
    attempt: (spec) => callOnce(spec, opts),
    onFallback: opts.onFallback,
  });
}

/** Extrae y valida JSON de la respuesta (tolera ```json ... ``` y texto alrededor). */
export function parseJson<S extends z.ZodType>(schema: S, text: string): z.infer<S> {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no hay JSON en la respuesta");
    raw = raw.slice(start, end + 1);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("JSON mal formado");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`no cumple el esquema: ${issue?.path.join(".") || "raíz"} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}
