/**
 * Tipos compartidos entre la API (route handlers) y la UI.
 * Las fechas viajan como cadenas ISO 8601 (JSON no tiene Date).
 */

export type AgentId = "orchestrator" | "develop" | "testing";
export type RunStatus = "running" | "passed" | "failed";
export type TaskStatus = "pending" | "running" | "failed" | "passed";

export interface RunDTO {
  id: number;
  request: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Run creado con el modo demo (fallo inicial forzado). */
  demo?: boolean;
}

/**
 * Criterio de aceptación que define el Orquestador y Testing comprueba de forma determinista sobre
 * el HTML renderizado (estado inicial del componente). Vocabulario cerrado: ver
 * src/lib/testing/acceptance.ts (validación zod) y src/lib/testing/README.md.
 */
export type AcceptanceCriterion =
  | { type: "text"; value: string }
  | { type: "element"; selector: string; min?: number }
  | { type: "field"; name: string; required?: boolean }
  | { type: "heading"; text: string; level?: number }
  | { type: "link"; text: string };

/** Resultado del último check: "skipped" = no se pudo comprobar (render omitido o fallido). */
export type AcceptanceStatus = "passed" | "failed" | "skipped";

export type AcceptanceItemDTO = AcceptanceCriterion & { status?: AcceptanceStatus };

export interface TaskDTO {
  id: number;
  runId: number;
  title: string;
  description: string;
  status: TaskStatus;
  attempts: number;
  lastFeedback: string | null;
  createdAt: string;
  updatedAt: string;
  /** Criterios del Orquestador con el estado de la última revisión de Testing ([] en tareas antiguas). */
  acceptance?: AcceptanceItemDTO[];
}

export interface FileDTO {
  id: number;
  taskId: number;
  path: string;
  content: string;
  version: number;
  createdAt: string;
}

export interface EventDTO {
  id: number;
  runId: number;
  taskId: number | null;
  agent: AgentId;
  message: string;
  createdAt: string;
}

/** GET /api/runs */
export interface RunListResponse {
  runs: RunDTO[];
}

/** GET /api/runs/[id] (con ?after=<eventId> solo trae los eventos nuevos) */
export interface RunDetailResponse {
  run: RunDTO;
  tasks: TaskDTO[];
  files: FileDTO[];
  events: EventDTO[];
}

/** POST /api/runs */
export interface CreateRunResponse {
  run: RunDTO;
}

export interface ApiError {
  error: string;
}
