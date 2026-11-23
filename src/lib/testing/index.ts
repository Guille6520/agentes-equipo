// Punto de entrada del módulo de testing determinista (sin LLM).
import { checkSyntax } from "./check-syntax";
import { checkA11y } from "./check-a11y";
import { checkContactForm, checkGenericForm } from "./check-contact-form";
import { checkSecurity } from "./check-security";
import { renderAndCheck } from "./check-render";
import { checkAcceptance } from "./check-acceptance";
import type { AcceptanceCriterion } from "@/lib/types";
import type { AcceptanceReport, CheckResult, GeneratedFile, TestReport } from "./types";

export type { GeneratedFile, CheckResult, TestReport, AcceptanceReport } from "./types";

/**
 * Perfil de checks. "contact-form" (por defecto, el comportamiento original) añade los checks de
 * formulario de contacto y exige form/email/textarea/botón en el render. "basic" deja sintaxis,
 * a11y, seguridad y un render que solo exige no lanzar y producir HTML.
 */
export type CheckProfile = "contact-form" | "form" | "basic";
export interface RunChecksOptions {
  profile?: CheckProfile;
  /** Criterios de aceptación del Orquestador (opcional): se comprueban sobre el HTML del render. */
  acceptance?: AcceptanceCriterion[];
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
  const form =
    profile === "contact-form"
      ? await safe("Formulario de contacto", () => checkContactForm(files))
      : profile === "form"
        ? await safe("Formulario", () => checkGenericForm(files))
        : [];
  const security = await safe("Seguridad", () => checkSecurity(files));
  results.push(...syntax, ...a11y, ...form, ...security);

  // El render ejecuta código: solo si la seguridad y la sintaxis están limpias. El HTML se reutiliza
  // para los criterios del Orquestador; sin HTML, esos criterios quedan omitidos (no aprobados).
  let html: string | null = null;
  let entry: string | undefined;
  let skipReason = "el componente no se pudo renderizar";
  if (security.some(isError)) {
    skipReason = "no se renderiza porque fallan los checks de seguridad";
    results.push(skipped("fallaron los checks de seguridad; no se ejecuta código no confiable."));
  } else if (syntax.some(isError)) {
    skipReason = "no se renderiza porque hay errores de sintaxis/tipos";
    results.push(skipped("hay errores de sintaxis/tipos."));
  } else {
    const expect = profile === "basic" ? "none" : profile;
    const rendered = await safe("Render en sandbox", () => {
      const r = renderAndCheck(files, { expect });
      html = r.html;
      entry = r.entry;
      return r.results;
    });
    results.push(...rendered);
  }

  let acceptance: AcceptanceReport | undefined;
  const criteria = options.acceptance ?? [];
  if (criteria.length > 0) {
    const out = await safe("Criterios del Orquestador", () => {
      const r = checkAcceptance(criteria, html, { entry, skipReason });
      const count = (s: string) => r.outcomes.filter((o) => o.status === s).length;
      acceptance = { total: criteria.length, passed: count("passed"), failed: count("failed"), skipped: count("skipped"), outcomes: r.outcomes };
      return r.results;
    });
    results.push(...out);
  }

  const failures = results.filter((r) => !r.passed);
  const passed = !results.some(isError);
  let summary = buildSummary(passed, failures, results.length);
  if (acceptance?.skipped) {
    summary += `
Criterios del Orquestador sin comprobar (${acceptance.skipped}/${acceptance.total}): ${skipReason}.`;
  }
  return { passed, results, failures, summary, ...(acceptance ? { acceptance } : {}) };
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
