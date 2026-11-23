// Llamada a un modelo con timeout, un reintento con backoff y respaldo cruzado de proveedor.
//
// Política por llamada lógica (peor caso ~3 x TIMEOUT_MS + backoff):
//   1. Modelo primario.
//   2. Si el fallo es transitorio (timeout, red, 429, 5xx o salida inválida): espera y reintenta una vez.
//   3. Si sigue fallando (o el fallo no es transitorio: 401/404, falta la clave): un intento con el
//      modelo del otro proveedor. Se avisa con `onFallback` para registrar un evento.
// Los mensajes de error solo llevan códigos/etiquetas cortas: nunca cuerpos de respuesta ni claves.
import { APICallError, generateText } from "ai";
import type { z } from "zod";
import { getLanguageModel, MissingKeyError, ROLE_MODELS, type ModelSpec, type Role } from "./models";

export const TIMEOUT_MS = 60_000;
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
  /** Se llama cuando el primario se da por perdido y se pasa al respaldo. */
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
    return { reason: `timeout ${TIMEOUT_MS / 1000} s`, retryable: true };
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
    timeout: TIMEOUT_MS,
  });
  try {
    return opts.parse(text);
  } catch (e) {
    throw new InvalidOutputError(e instanceof Error ? e.message.slice(0, 160) : "no se pudo interpretar");
  }
}

export async function callModel<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const { primary, fallback } = ROLE_MODELS[opts.role];
  const reasons: string[] = [];
  let lastReason = "";
  const t0 = Date.now();

  // Primario: intento + un reintento con backoff si el fallo es transitorio.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await callOnce(primary, opts);
      return { data, model: primary, usedFallback: false, ms: Date.now() - t0 };
    } catch (e) {
      const d = describeError(e);
      reasons.push(`${primary.label}: ${d.reason}`);
      lastReason = attempt === 2 ? `${d.reason}, tras reintento` : d.reason;
      if (!d.retryable || attempt === 2) break;
      await sleep(d.status === 429 ? BACKOFF_429_MS : BACKOFF_MS);
    }
  }

  await opts.onFallback?.({ from: primary, to: fallback, reason: lastReason });

  const t1 = Date.now();
  try {
    const data = await callOnce(fallback, opts);
    return { data, model: fallback, usedFallback: true, ms: Date.now() - t1 };
  } catch (e) {
    reasons.push(`${fallback.label}: ${describeError(e).reason}`);
    throw new AllModelsFailedError(reasons);
  }
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
