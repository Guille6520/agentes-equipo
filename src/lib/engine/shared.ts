// Utilidades comunes del motor: eventos, perfil de checks y archivos vigentes.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, events, files, tasks } from "@/db";
import type { Role } from "@/lib/ai/models";
import type { CheckProfile, GeneratedFile } from "@/lib/testing";

export const MAX_ATTEMPTS = 3;
/** A partir de cuántos pasos seguidos sin modelo disponible se da el run por fallido. */
export const MAX_STEP_ERRORS = 3;

export type TaskRow = typeof tasks.$inferSelect;

export function eventValues(runId: number, agent: Role, message: string, taskId?: number | null) {
  return { runId, agent, message: message.slice(0, 1000), taskId: taskId ?? null };
}

export async function logEvent(runId: number, agent: Role, message: string, taskId?: number | null) {
  await db.insert(events).values(eventValues(runId, agent, message, taskId));
}

/**
 * Perfil de checks decidido de forma determinista por el texto de la tarea: los checks de
 * formulario de contacto solo aplican si la tarea habla de un formulario. Así una tarea como
 * "enlace en la navegación" no se suspende por no tener <form>.
 */
export function profileFor(title: string, description: string): CheckProfile {
  return /formulario|\bforms?\b/i.test(`${title} ${description}`) ? "contact-form" : "basic";
}

export const profileLabel = (p: string) => (p === "contact-form" ? "formulario de contacto" : "básico");

/** Archivos de la última versión entregada de cada tarea (versión = número de intento). */
export async function latestFiles(taskRows: TaskRow[]): Promise<Map<number, GeneratedFile[]>> {
  const out = new Map<number, GeneratedFile[]>();
  const withFiles = taskRows.filter((t) => t.attempts > 0);
  if (withFiles.length === 0) return out;
  const rows = await db
    .select()
    .from(files)
    .where(inArray(files.taskId, withFiles.map((t) => t.id)))
    .orderBy(asc(files.taskId), asc(files.path));
  for (const t of withFiles) {
    out.set(
      t.id,
      rows.filter((f) => f.taskId === t.id && f.version === t.attempts).map((f) => ({ path: f.path, content: f.content })),
    );
  }
  return out;
}

/** Archivos de las tareas anteriores ya aprobadas: Develop puede importarlos y Testing los necesita para resolver imports. */
export async function dependencyFiles(runTasks: TaskRow[], current: TaskRow): Promise<GeneratedFile[]> {
  const deps = runTasks.filter((t) => t.id < current.id && t.status === "passed");
  const map = await latestFiles(deps);
  return deps.flatMap((t) => map.get(t.id) ?? []);
}

export async function tasksOf(runId: number): Promise<TaskRow[]> {
  return db.select().from(tasks).where(eq(tasks.runId, runId)).orderBy(asc(tasks.id));
}

export async function filesOfVersion(taskId: number, version: number): Promise<GeneratedFile[]> {
  const rows = await db
    .select({ path: files.path, content: files.content })
    .from(files)
    .where(and(eq(files.taskId, taskId), eq(files.version, version)))
    .orderBy(asc(files.path));
  return rows;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
