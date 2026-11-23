import type { events, files, runs, tasks } from "@/db";
import type { EventDTO, FileDTO, RunDTO, TaskDTO } from "@/lib/types";

export function toRunDTO(r: typeof runs.$inferSelect): RunDTO {
  return {
    id: r.id,
    request: r.request,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    demo: r.demoForceFailure,
  };
}

export function toTaskDTO(t: typeof tasks.$inferSelect): TaskDTO {
  return {
    id: t.id,
    runId: t.runId,
    title: t.title,
    description: t.description,
    status: t.status,
    attempts: t.attempts,
    lastFeedback: t.lastFeedback,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toFileDTO(f: typeof files.$inferSelect): FileDTO {
  return {
    id: f.id,
    taskId: f.taskId,
    path: f.path,
    content: f.content,
    version: f.version,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toEventDTO(e: typeof events.$inferSelect): EventDTO {
  return {
    id: e.id,
    runId: e.runId,
    taskId: e.taskId,
    agent: e.agent,
    message: e.message,
    createdAt: e.createdAt.toISOString(),
  };
}
