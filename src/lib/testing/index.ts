// Punto de entrada del módulo de testing determinista (sin LLM).
import { checkSyntax } from "./check-syntax";
import { checkA11y } from "./check-a11y";
import { checkContactForm } from "./check-contact-form";
import { checkSecurity } from "./check-security";
import { checkRender } from "./check-render";
import type { CheckResult, GeneratedFile, TestReport } from "./types";

export type { GeneratedFile, CheckResult, TestReport } from "./types";

/**
 * Perfil de checks. "contact-form" (por defecto, el comportamiento original) añade los checks de
 * formulario de contacto y exige form/email/textarea/botón en el render. "basic" deja sintaxis,
 * a11y, seguridad y un render que solo exige no lanzar y producir HTML.
 */
export type CheckProfile = "contact-form" | "basic";
export interface RunChecksOptions {
  profile?: CheckProfile;
}

const isError = (r: CheckResult) => !r.passed && r.severity === "error";

const skipped = (reason: string): CheckResult => ({
  id: "render", name: "Render en sandbox", passed: true, severity: "error", message: `Omitido: ${reason}`,
});

/** Ejecuta todos los checks. Pasa solo si no hay ningún fallo de severidad "error". */
export async function runChecks(files: GeneratedFile[], options: RunChecksOptions = {}): Promise<TestReport> {
  const profile = options.profile ?? "contact-form";
  const results: CheckResult[] = [];
  const safe = async (name: string, fn: () => CheckResult[] | Promise<CheckResult[]>) => {
    try {
      return await fn();
    } catch (e) {
      // Un check que explota cuenta como fallo, no debe tumbar al agente.
      return [{ id: "internal", name, passed: false, severity: "error", message: `Error interno del check: ${e instanceof Error ? e.message : String(e)}` } as CheckResult];
    }
  };

  const syntax = await safe("Sintaxis y tipos", () => checkSyntax(files));
  const a11y = await safe("Accesibilidad", () => checkA11y(files));
  const form = profile === "contact-form" ? await safe("Formulario de contacto", () => checkContactForm(files)) : [];
  const security = await safe("Seguridad", () => checkSecurity(files));
  results.push(...syntax, ...a11y, ...form, ...security);

  // El render ejecuta código: solo si la seguridad y la sintaxis están limpias.
  if (security.some(isError)) results.push(skipped("fallaron los checks de seguridad; no se ejecuta código no confiable."));
  else if (syntax.some(isError)) results.push(skipped("hay errores de sintaxis/tipos."));
  else results.push(...(await safe("Render en sandbox", () => checkRender(files, { expectContactForm: profile === "contact-form" }))));

  const failures = results.filter((r) => !r.passed);
  const passed = !results.some(isError);
  return { passed, results, failures, summary: buildSummary(passed, failures, results.length) };
}

function buildSummary(passed: boolean, failures: CheckResult[], total: number): string {
  if (failures.length === 0) return `Todos los checks pasan (${total}).`;
  const lines = failures.map((f) => {
    const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
    return `- [${f.severity === "error" ? "ERROR" : "AVISO"}] ${f.name}${where}: ${f.message}`;
  });
  const head = passed ? "Hay avisos, pero no errores:" : `Fallan ${failures.length} comprobaciones, corrígelas:`;
  return [head, ...lines].join("\n");
}
