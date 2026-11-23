// Tipos compartidos entre la API de evaluaciones y la UI (las fechas viajan como ISO 8601).
import type { EvalTest } from "./models";

export type ResultStatus = "pending" | "done" | "not_measured";

export interface EvalMetrics {
  latencyMs?: number | null;
  /** La latencia es aproximada (el informe manual da "~14 s"). */
  latencyApprox?: boolean;
  /** Latencia media del modelo según el informe manual (solo en histórico). */
  reportedAvgMs?: number | null;
  tokens?: number | null;
  // Orquestador
  jsonValid?: boolean;
  strictJson?: boolean;
  sensible?: boolean;
  tasks?: number;
  // Develop
  compiles?: boolean;
  checksPassed?: number;
  checksTotal?: number;
  failedChecks?: string[];
  // Testing
  bug1?: boolean;
  bug2?: boolean;
  both?: boolean;
  note?: string;
}

export interface EvalResultDTO {
  id: number;
  runId: number;
  model: string;
  provider: string;
  test: EvalTest;
  step: number;
  status: ResultStatus;
  ok: boolean | null;
  metrics: EvalMetrics | null;
  error: string | null;
  finishedAt: string | null;
}

export interface EvalRunDTO {
  id: number;
  origin: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface ModelRowDTO {
  id: string;
  label: string;
  provider: string;
  finalist: boolean;
  /** Evaluación completa más reciente de este modelo (null si nunca se midió). */
  run: EvalRunDTO | null;
  results: Partial<Record<EvalTest, EvalResultDTO>>;
}

export interface ActiveRunDTO {
  run: EvalRunDTO;
  steps: EvalResultDTO[];
  /** true si alguna función tiene ahora el lease (un paso ejecutándose). */
  busy: boolean;
}

export interface EvalsOverview {
  models: ModelRowDTO[];
  active: ActiveRunDTO | null;
  /** Segundos que faltan para poder lanzar otra evaluación (0 = ya se puede). */
  cooldownSeconds: number;
}

export type StepState = "step_done" | "busy" | "finished";
export interface StepResponse {
  state: StepState;
  result?: EvalResultDTO;
}
