import "./setup";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { describeError, parseJson } from "@/lib/ai/generate";
import { MissingKeyError } from "@/lib/ai/models";

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
