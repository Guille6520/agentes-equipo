// Tipos públicos del módulo de testing determinista.
import type { AcceptanceCriterion, AcceptanceStatus } from "@/lib/types";

/** Un archivo generado por el agente Develop. */
export type GeneratedFile = { path: string; content: string };

/** Resultado de una comprobación concreta. */
export type CheckResult = {
  id: string;
  name: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
};

/** Informe final. `passed` es true solo si no hay fallos de severidad "error". */
export type TestReport = {
  passed: boolean;
  results: CheckResult[];
  failures: CheckResult[];
  /** Texto breve en español, listo para pasarlo a Develop como feedback. */
  summary: string;
  /** Solo si se pasaron criterios del Orquestador: estado de cada uno, en el mismo orden. */
  acceptance?: AcceptanceReport;
};

export type AcceptanceReport = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  outcomes: { criterion: AcceptanceCriterion; status: AcceptanceStatus; message: string }[];
};

/** Un check recibe todos los archivos y devuelve uno o varios resultados. */
export type Check = (files: GeneratedFile[]) => CheckResult[] | Promise<CheckResult[]>;
