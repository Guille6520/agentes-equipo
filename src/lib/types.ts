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
