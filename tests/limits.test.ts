import "./setup";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideLimits, MAX_RUNS_PER_HOUR } from "../src/app/api/runs/_limits";

const base = { activeRuns: 0, runsLastHour: 0, secondsUntilSlot: 0 };

describe("decideLimits", () => {
  it("permite cuando no hay nada en curso", () => assert.deepEqual(decideLimits(base), { ok: true }));
  it("permite con 9 runs en la hora", () => assert.deepEqual(decideLimits({ ...base, runsLastHour: MAX_RUNS_PER_HOUR - 1 }), { ok: true }));
  it("409 si hay un run en curso", () => {
    const d = decideLimits({ ...base, activeRuns: 1 });
    assert.deepEqual(d, { ok: false, status: 409, error: "Ya hay una ejecución en curso; espera a que termine" });
  });
  it("429 al llegar a 10 por hora, con minutos redondeados hacia arriba", () => {
    const d = decideLimits({ activeRuns: 0, runsLastHour: 10, secondsUntilSlot: 61 });
    assert.deepEqual(d, { ok: false, status: 429, error: "Límite de 10 ejecuciones por hora alcanzado; vuelve a intentarlo en 2 min" });
  });
  it("mínimo 1 min", () => {
    const d = decideLimits({ activeRuns: 0, runsLastHour: 10, secondsUntilSlot: 0 });
    assert.ok(!d.ok && d.error.endsWith("en 1 min"));
  });
  it("el 409 tiene prioridad sobre el 429", () => {
    const d = decideLimits({ activeRuns: 1, runsLastHour: 10, secondsUntilSlot: 600 });
    assert.ok(!d.ok && d.status === 409);
  });
});
