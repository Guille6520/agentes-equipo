// Uso: npx tsx src/lib/testing/run-fixtures.ts
// Ejecuta runChecks sobre cada fixture y comprueba que el resultado es el esperado.
import fs from "node:fs";
import path from "node:path";
import { runChecks } from "./index";

// fixture -> ids de check (prefijo) que DEBEN fallar con severidad error. [] = debe pasar todo.
const EXPECTED: Record<string, string[]> = {
  ok: [],
  "sin-label": ["a11y-label"],
  "sin-onsubmit": ["form-onsubmit"],
  "email-sin-type": ["form-email-type"],
  "dangerous-html": ["security-dangerously-html"],
  "error-sintaxis": ["syntax"],
  "error-de-tipos": ["syntax"],
  "clave-falsa": ["security-secret"],
  "bucle-infinito": ["render"],
};

async function main() {
  const dir = path.join(__dirname, "__fixtures__");
  const rows: { fixture: string; status: string; detail: string }[] = [];
  let bad = 0;

  for (const [name, expectedIds] of Object.entries(EXPECTED)) {
    const content = fs.readFileSync(path.join(dir, `${name}.tsx.txt`), "utf8");
    const report = await runChecks([{ path: "ContactPage.tsx", content }]);
    const failedIds = [...new Set(report.failures.filter((f) => f.severity === "error").map((f) => f.id))];
    const expectPass = expectedIds.length === 0;
    const ok = expectPass
      ? report.passed
      : !report.passed && expectedIds.every((id) => failedIds.includes(id));
    if (!ok) bad++;
    rows.push({
      fixture: name,
      status: ok ? "OK" : "FAIL",
      detail: `esperado: ${expectPass ? "pasa" : "falla " + expectedIds.join(",")} | real: ${report.passed ? "pasa" : "falla " + failedIds.join(",")}`,
    });
    if (!ok) console.log(`\n[${name}] resumen:\n${report.summary}\n`);
  }

  console.table(rows);
  console.log(bad === 0 ? "Todos los fixtures coinciden." : `${bad} fixture(s) no coinciden.`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
