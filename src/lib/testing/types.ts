// Tipos públicos del módulo de testing determinista.

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
};

/** Un check recibe todos los archivos y devuelve uno o varios resultados. */
export type Check = (files: GeneratedFile[]) => CheckResult[] | Promise<CheckResult[]>;
