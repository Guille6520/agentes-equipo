// advanceRun: hace UNA unidad de trabajo sobre un run y dice si queda más.
//
// Todo el estado vive en BD (runs/tasks/files/events), así que cualquier invocación serverless puede
// continuar donde se quedó la anterior. El lease evita que dos invocaciones avancen a la vez.
// Unidades de trabajo, en orden:
//   1. Sin tareas -> Orquestador planifica.
//   2. Primera tarea no terminada (por id): fase "develop" -> Develop; fase "testing" -> Testing.
//   3. Todas terminadas -> se cierra el run (passed si todas pasan, failed si alguna falló).
// Las tareas se procesan de una en una y en orden: las posteriores pueden importar los archivos de
// las anteriores y el consumo de cuota gratuita es predecible.
import { eq } from "drizzle-orm";
import { db, events, runs } from "@/db";
import { AllModelsFailedError } from "@/lib/ai/generate";
import { developTask } from "./develop";
import { acquireLease, LeaseLostError } from "./lease";
import { planRun } from "./orchestrator";
import { eventValues, logEvent, MAX_STEP_ERRORS, tasksOf } from "./shared";
import { testTask } from "./testing";

export type AdvanceOutcome =
  /** Se hizo una unidad de trabajo. */
  | "worked"
  /** Otro proceso tiene el lease. */
  | "busy"
  /** El run ya terminó, no existe o no lo gestiona el motor (p. ej. el run de demo). */
  | "idle"
  /** El paso falló (modelos caídos o error inesperado); se reintentará. */
  | "error";

export interface AdvanceResult {
  outcome: AdvanceOutcome;
  /** true si el run sigue en curso y tiene sentido volver a llamar. */
  more: boolean;
  runStatus: "running" | "passed" | "failed" | null;
}

export async function advanceRun(runId: number): Promise<AdvanceResult> {
  const lease = await acquireLease(runId);
  if (!lease) {
    const [run] = await db.select({ status: runs.status, managed: runs.engineManaged }).from(runs).where(eq(runs.id, runId));
    if (!run) return { outcome: "idle", more: false, runStatus: null };
    const more = run.status === "running" && run.managed;
    return { outcome: more ? "busy" : "idle", more, runStatus: run.status };
  }

  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (!run || run.status !== "running") return { outcome: "idle", more: false, runStatus: run?.status ?? null };

    try {
      const status = await step(run, lease);
      return { outcome: "worked", more: status === "running", runStatus: status };
    } catch (e) {
      if (e instanceof LeaseLostError) return { outcome: "busy", more: true, runStatus: "running" };
      return await recordStepError(run, e);
    }
  } finally {
    await lease.release().catch(() => {});
  }
}

async function step(run: typeof runs.$inferSelect, lease: Parameters<typeof planRun>[1]) {
  const runTasks = await tasksOf(run.id);

  if (runTasks.length === 0) {
    await planRun(run, lease);
    return "running" as const;
  }

  const next = runTasks.find((t) => t.status === "pending" || t.status === "running");
  if (next) {
    if (next.phase === "testing" && next.attempts > 0) await testTask(run, next, runTasks, lease);
    else await developTask(run, next, runTasks, lease);
    return "running" as const;
  }

  // Todas terminadas: cierre del run.
  const failed = runTasks.filter((t) => t.status === "failed");
  const status = failed.length === 0 ? ("passed" as const) : ("failed" as const);
  await lease.assertHeld();
  await db.batch([
    db.update(runs).set({ status, finishedAt: new Date() }).where(eq(runs.id, run.id)),
    db.insert(events).values(
      eventValues(
        run.id,
        "orchestrator",
        status === "passed"
          ? `Run completado: ${runTasks.length === 1 ? "la tarea pasa" : `las ${runTasks.length} tareas pasan`} Testing.`
          : `Run fallido: ${failed.length} de ${runTasks.length} tareas agotaron los intentos (${failed.map((t) => t.title).join(", ")}).`,
      ),
    ),
  ]);
  return status;
}

/** Un paso que falla no rompe el run a la primera: se reintenta hasta MAX_STEP_ERRORS veces seguidas. */
async function recordStepError(run: typeof runs.$inferSelect, e: unknown): Promise<AdvanceResult> {
  const errors = run.stepErrors + 1;
  const reason =
    e instanceof AllModelsFailedError ? `ningún modelo respondió (${e.reasons.join("; ")})` : "error interno del motor";
  if (!(e instanceof AllModelsFailedError)) console.error("[engine] paso fallido", run.id, e);

  if (errors >= MAX_STEP_ERRORS) {
    await db.batch([
      db.update(runs).set({ status: "failed", finishedAt: new Date(), stepErrors: errors }).where(eq(runs.id, run.id)),
      db.insert(events).values(
        eventValues(run.id, "orchestrator", `Run detenido tras ${errors} pasos fallidos seguidos: ${reason}.`),
      ),
    ]);
    return { outcome: "error", more: false, runStatus: "failed" };
  }
  await db.update(runs).set({ stepErrors: errors }).where(eq(runs.id, run.id));
  await logEvent(run.id, "orchestrator", `Paso fallido (${errors}/${MAX_STEP_ERRORS}): ${reason}. Se reintentará.`);
  return { outcome: "error", more: true, runStatus: "running" };
}
