// Uso: npx tsx src/lib/testing/run-fixtures.ts
// Ejecuta runChecks sobre cada fixture y comprueba que el resultado es el esperado.
import fs from "node:fs";
import path from "node:path";
import { runChecks } from "./index";
import { parseAcceptance } from "./acceptance";
import type { AcceptanceCriterion } from "@/lib/types";

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

// Fixtures del perfil "form" (formulario genérico: newsletter, registro...): no exige nombre ni mensaje.
const EXPECTED_FORM: Record<string, string[]> = {
  "newsletter-ok": [],
  "newsletter-sin-validacion": ["form-required"],
};

// Criterios del Orquestador: [fixture, perfil, criterios, ids que deben fallar ([] = pasa), criterios omitidos esperados].
type AcceptanceCase = [string, string, "contact-form" | "form", AcceptanceCriterion[], string[], number];
const ACCEPTANCE_CASES: AcceptanceCase[] = [
  [
    "criterios-cumplidos", "ok", "contact-form",
    [
      { type: "heading", text: "contacto", level: 1 },
      { type: "text", value: "Enviar" },
      { type: "field", name: "email", required: true },
      { type: "element", selector: "input[type=email]" },
      { type: "element", selector: "input", min: 2 },
    ],
    [], 0,
  ],
  ["criterio-texto-falta", "ok", "contact-form", [{ type: "text", value: "Enviar" }, { type: "text", value: "Mandar consulta" }], ["acceptance-text"], 0],
  ["criterio-campo-falta", "newsletter-ok", "form", [{ type: "field", name: "telefono" }], ["acceptance-field"], 0],
  ["criterio-elementos-min", "newsletter-ok", "form", [{ type: "element", selector: "li", min: 3 }], ["acceptance-element"], 0],
  ["criterio-enlace-falta", "newsletter-ok", "form", [{ type: "link", text: "Inicio" }], ["acceptance-link"], 0],
  ["criterio-required-falta", "newsletter-sin-validacion", "form", [{ type: "field", name: "email", required: true }], ["acceptance-field"], 0],
  // Sin render (error de sintaxis) los criterios quedan omitidos, no aprobados ni suspendidos.
  ["criterios-omitidos", "error-sintaxis", "contact-form", [{ type: "text", value: "Enviar" }, { type: "heading", text: "Contacto" }], ["syntax"], 2],
];

async function main() {
  const dir = path.join(__dirname, "__fixtures__");
  const rows: { fixture: string; status: string; detail: string }[] = [];
  let bad = 0;

  const cases: [string, string[], "contact-form" | "form"][] = [
    ...Object.entries(EXPECTED).map(([n, ids]): [string, string[], "contact-form"] => [n, ids, "contact-form"]),
    ...Object.entries(EXPECTED_FORM).map(([n, ids]): [string, string[], "form"] => [n, ids, "form"]),
  ];

  for (const [name, expectedIds, profile] of cases) {
    const content = fs.readFileSync(path.join(dir, `${name}.tsx.txt`), "utf8");
    const report = await runChecks([{ path: "ContactPage.tsx", content }], { profile });
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

  for (const [label, fixture, profile, acceptance, expectedIds, expectedSkipped] of ACCEPTANCE_CASES) {
    const content = fs.readFileSync(path.join(dir, `${fixture}.tsx.txt`), "utf8");
    const report = await runChecks([{ path: "ContactPage.tsx", content }], { profile, acceptance });
    const failedIds = [...new Set(report.failures.filter((f) => f.severity === "error").map((f) => f.id))];
    const acceptanceFailed = failedIds.filter((id) => id.startsWith("acceptance-"));
    const a = report.acceptance;
    const expectPass = expectedIds.length === 0;
    const ok =
      !!a &&
      a.skipped === expectedSkipped &&
      (expectPass ? report.passed : !report.passed && expectedIds.every((id) => failedIds.includes(id))) &&
      // Ningún fallo acceptance-* que no se esperase (p. ej. el criterio que sí se cumple).
      acceptanceFailed.every((id) => expectedIds.includes(id)) &&
      a.passed + a.failed + a.skipped === a.total;
    if (!ok) bad++;
    rows.push({
      fixture: `${label} (${fixture})`,
      status: ok ? "OK" : "FAIL",
      detail: `esperado: ${expectPass ? "pasa" : "falla " + expectedIds.join(",")}${expectedSkipped ? `, ${expectedSkipped} omitidos` : ""} | real: ${
        report.passed ? "pasa" : "falla " + failedIds.join(",")
      } | criterios ${a?.passed ?? 0}/${a?.total ?? 0} cumplidos, ${a?.skipped ?? 0} omitidos`,
    });
    if (!ok) console.log(`
[${label}] resumen:
${report.summary}
`);
  }

  // Validación del vocabulario: los criterios inválidos se descartan sin tumbar el resto.
  const parsed = parseAcceptance([
    { type: "text", value: "Enviar" },
    { type: "element", selector: 'INPUT[type="email"]' },
    { type: "element", selector: "div" }, // selector no admitido
    { type: "color", value: "rojo" }, // tipo desconocido
    { type: "text", value: "" }, // vacío
    "texto suelto",
    { type: "text", value: "Enviar" }, // repetido
  ]);
  const parseOk =
    parsed.criteria.length === 2 &&
    parsed.discarded === 5 &&
    parsed.criteria[1].type === "element" &&
    parsed.criteria[1].selector === "input[type=email]" &&
    parseAcceptance(undefined).criteria.length === 0;
  if (!parseOk) bad++;
  rows.push({
    fixture: "parseAcceptance (vocabulario)",
    status: parseOk ? "OK" : "FAIL",
    detail: `esperado: 2 válidos, 5 descartados | real: ${parsed.criteria.length} válidos, ${parsed.discarded} descartados`,
  });

  console.table(rows);
  console.log(bad === 0 ? "Todos los fixtures coinciden." : `${bad} fixture(s) no coinciden.`);
  process.exit(bad === 0 ? 0 : 1);
}

main();
