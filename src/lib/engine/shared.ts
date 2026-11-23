// Utilidades comunes del motor: eventos, perfil de checks y archivos vigentes.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, events, files, tasks } from "@/db";
import type { Role } from "@/lib/ai/models";
import type { CheckProfile, GeneratedFile } from "@/lib/testing";
import { redact } from "@/lib/security/redact";
import { parseAcceptance } from "@/lib/testing/acceptance";
import type { AcceptanceCriterion } from "@/lib/types";

export const MAX_ATTEMPTS = 3;
/** A partir de cuántos pasos seguidos sin modelo disponible se da el run por fallido. */
export const MAX_STEP_ERRORS = 3;

export type TaskRow = typeof tasks.$inferSelect;

/** Fila de evento. El mensaje se tacha (secretos) ANTES de recortarlo, para no cortar un secreto a medias. */
export function eventValues(runId: number, agent: Role, message: string, taskId?: number | null) {
  return { runId, agent, message: redact(message).slice(0, 1000), taskId: taskId ?? null };
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
  const text = `${title} ${description}`;
  if (!/formulario|\bforms?\b/i.test(text)) return "basic";
  // Solo los formularios de contacto exigen nombre/email/mensaje; el resto (newsletter, registro...) usa el genérico.
  return /contacto|\bcontact\b/i.test(text) ? "contact-form" : "form";
}

export const profileLabel = (p: string) =>
  p === "contact-form" ? "formulario de contacto" : p === "form" ? "formulario" : "básico";

/** Criterios del Orquestador de una tarea (sin el estado de la última revisión). [] en tareas antiguas. */
export function taskCriteria(task: TaskRow): AcceptanceCriterion[] {
  // parseAcceptance elimina la clave `status` (zod descarta claves desconocidas) y lo que no sea válido.
  return parseAcceptance(task.acceptance ?? []).criteria;
}

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

/**
 * Bloque de datos delimitado para un prompt: `<tag>` + texto + `</tag>`. Quita del texto cualquier
 * etiqueta de apertura o cierre con ese mismo nombre, para que una petición no pueda «cerrar» el
 * bloque y escribir fuera de él como si fueran instrucciones.
 */
export function dataBlock(tag: string, text: string): string {
  const clean = text.replace(new RegExp(`<\\s*/?\\s*${tag}\\s*>`, "gi"), "");
  return `<${tag}>\n${clean}\n</${tag}>`;
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
