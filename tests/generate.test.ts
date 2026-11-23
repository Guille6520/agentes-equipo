import "./setup";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { APICallError } from "ai";
import { AllModelsFailedError, chainSteps, describeError, parseJson, runChain } from "@/lib/ai/generate";
import {
  GEMINI_FLASH_LITE,
  GROQ_FALLBACK,
  LAGUNA,
  MissingKeyError,
  ROLE_MODELS,
  type ModelSpec,
  type RoleChain,
} from "@/lib/ai/models";

const schema = z.object({ a: z.number() });

describe("parseJson", () => {
  it("lee JSON plano", () => assert.deepEqual(parseJson(schema, '{"a":1}'), { a: 1 }));
  it("tolera valla markdown", () => assert.deepEqual(parseJson(schema, 'Aquí:\n```json\n{"a":2}\n```'), { a: 2 }));
  it("tolera texto alrededor", () => assert.deepEqual(parseJson(schema, 'Respuesta: {"a":3} fin'), { a: 3 }));
  it("falla sin JSON", () => assert.throws(() => parseJson(schema, "nada"), /no hay JSON/));
  it("falla con JSON mal formado", () => assert.throws(() => parseJson(schema, '{"a":}'), /JSON mal formado/));
  it("falla si no cumple el esquema", () => assert.throws(() => parseJson(schema, '{"a":"x"}'), /no cumple el esquema: a/));
});

describe("describeError", () => {
  it("timeout es reintentable", () => {
    const e = new Error("request timed out");
    assert.deepEqual(describeError(e), { reason: "timeout", retryable: true });
  });
  it("AbortError cuenta como timeout", () => {
    const e = new Error("x");
    e.name = "AbortError";
    assert.equal(describeError(e).reason, "timeout");
  });
  it("falta de clave no es reintentable", () => {
    assert.equal(describeError(new MissingKeyError("NVIDIA_API_KEY")).retryable, false);
  });
  it("sigue la causa", () => {
    const e = new Error("wrapper", { cause: new Error("timed out") });
    assert.equal(describeError(e).reason, "timeout");
  });
  it("error desconocido se reintenta y no filtra el mensaje", () => {
    const r = describeError(new Error("secreto sk-123"));
    assert.equal(r.retryable, true);
    assert.ok(!r.reason.includes("sk-123"));
  });
});

// ---------- Cadena de respaldo (sin red: `attempt` simulado) ----------

const CHAIN: RoleChain = { primary: LAGUNA, fallbacks: [GEMINI_FLASH_LITE, GROQ_FALLBACK] };
const http = (status: number) =>
  new APICallError({ message: `HTTP ${status}`, url: "https://x", requestBodyValues: {}, statusCode: status });

/** Ejecuta la cadena con un guion de resultados por modelo; devuelve el resultado, las llamadas y los saltos. */
async function simulate(script: Record<string, Array<"ok" | Error>>) {
  const calls: string[] = [];
  const hops: string[] = [];
  const left = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const run = runChain<string>(CHAIN, {
    attempt: async (spec: ModelSpec) => {
      calls.push(spec.label);
      const next = left[spec.label]?.shift() ?? new Error("sin guion");
      if (next === "ok") return `respuesta de ${spec.label}`;
      throw next;
    },
    onFallback: ({ from, to, reason }) => {
      hops.push(`${from.label} -> ${to.label} (${reason})`);
    },
    sleep: async () => {},
  });
  return { run, calls, hops };
}

describe("cadena de respaldo", () => {
  it("los tres roles usan Laguna -> Gemini -> Groq", () => {
    for (const chain of Object.values(ROLE_MODELS)) {
      assert.deepEqual(
        chainSteps(chain).map((s) => [s.spec.provider, s.maxAttempts]),
        [["nvidia", 2], ["google", 1], ["groq", 1]],
      );
    }
  });

  it("si el primario responde no hay saltos", async () => {
    const s = await simulate({ "laguna-xs-2.1": ["ok"] });
    const r = await s.run;
    assert.equal(r.model.label, "laguna-xs-2.1");
    assert.equal(r.usedFallback, false);
    assert.deepEqual(s.hops, []);
  });

  it("reintenta el primario una vez ante un fallo transitorio", async () => {
    const s = await simulate({ "laguna-xs-2.1": [http(503), "ok"] });
    const r = await s.run;
    assert.equal(r.usedFallback, false);
    assert.deepEqual(s.calls, ["laguna-xs-2.1", "laguna-xs-2.1"]);
  });

  it("primario y Gemini caídos: llega a Groq y registra cada salto", async () => {
    const s = await simulate({ "laguna-xs-2.1": [http(500), http(500)], "gemini-3.1-flash-lite": [http(503)], [GROQ_FALLBACK.label]: ["ok"] });
    const r = await s.run;
    assert.equal(r.model.provider, "groq");
    assert.equal(r.usedFallback, true);
    assert.deepEqual(s.calls, ["laguna-xs-2.1", "laguna-xs-2.1", "gemini-3.1-flash-lite", GROQ_FALLBACK.label]);
    assert.deepEqual(s.hops, [
      "laguna-xs-2.1 -> gemini-3.1-flash-lite (HTTP 500, tras reintento)",
      `gemini-3.1-flash-lite -> ${GROQ_FALLBACK.label} (HTTP 503)`,
    ]);
  });

  it("un fallo no reintentable del primario salta sin reintento", async () => {
    const s = await simulate({ "laguna-xs-2.1": [http(401)], "gemini-3.1-flash-lite": ["ok"] });
    const r = await s.run;
    assert.equal(r.model.provider, "google");
    assert.deepEqual(s.calls, ["laguna-xs-2.1", "gemini-3.1-flash-lite"]);
  });

  it("un respaldo sin clave se salta sin tumbar el resto", async () => {
    const s = await simulate({
      "laguna-xs-2.1": [new MissingKeyError("NVIDIA_API_KEY")],
      "gemini-3.1-flash-lite": [new MissingKeyError("GOOGLE_GENERATIVE_AI_API_KEY")],
      [GROQ_FALLBACK.label]: ["ok"],
    });
    const r = await s.run;
    assert.equal(r.model.provider, "groq");
    assert.equal(s.calls.length, 3, "MissingKeyError no se reintenta");
    assert.match(s.hops[1], /falta la variable GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it("si fallan todos lanza AllModelsFailedError con un motivo por intento", async () => {
    const s = await simulate({
      "laguna-xs-2.1": [http(503), http(503)],
      "gemini-3.1-flash-lite": [http(503)],
      [GROQ_FALLBACK.label]: [http(429)],
    });
    await assert.rejects(s.run, (e: unknown) => {
      assert.ok(e instanceof AllModelsFailedError);
      assert.equal(e.reasons.length, 4);
      return true;
    });
    assert.equal(s.hops.length, 2, "no hay salto después del último respaldo");
  });
});
