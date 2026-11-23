import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { it } from "node:test";

// run-fixtures.ts se ejecuta solo (main() + process.exit), así que se lanza como proceso hijo:
// sale con código 0 únicamente si todos los fixtures producen el resultado esperado.
it("los fixtures de Testing dan el resultado esperado", () => {
  const root = path.join(__dirname, "..");
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/lib/testing/run-fixtures.ts"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
