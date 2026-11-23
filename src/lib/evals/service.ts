// Lógica de evaluaciones: crear (con límite de uso), ejecutar el siguiente paso (con lease) y
// montar la vista general. Todas las comparaciones de hora usan now() de Postgres.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, evalResults, evalRuns } from "@/db";
import {
  APP_ORIGIN,
  COOLDOWN_SECONDS,
  EVAL_MODELS,
  EVAL_TESTS,
  MANUAL_ORIGIN,
  STALE_RUN_MINUTES,
  STEP_PLAN,
  type EvalTest,
} from "./models";
import { runEvalStep } from "./run-step";
import type {
  EvalMetrics,
  EvalResultDTO,
  EvalRunDTO,
  EvalsOverview,
  ModelRowDTO,
  ResultStatus,
  StepResponse,
} from "./types";

/** Debe superar a la función más larga (maxDuration 60 s) para que nunca se solapen dos pasos. */
const LEASE_SECONDS = 75;

type RunRow = typeof evalRuns.$inferSelect;
type ResultRow = typeof evalResults.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toRunDTO = (r: RunRow): EvalRunDTO => ({
  id: r.id,
  origin: r.origin,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  finishedAt: iso(r.finishedAt),
});

const toResultDTO = (r: ResultRow): EvalResultDTO => ({
  id: r.id,
  runId: r.runId,
  model: r.model,
  provider: r.provider,
  test: r.test as EvalTest,
  step: r.step,
  status: r.status as ResultStatus,
  ok: r.ok,
  metrics: (r.metrics as EvalMetrics | null) ?? null,
  error: r.error,
  finishedAt: iso(r.finishedAt),
});

// ---------- Crear una evaluación ----------

export type CreateOutcome =
  | { kind: "created"; run: EvalRunDTO }
  | { kind: "running"; runId: number }
  | { kind: "cooldown"; retryAfterSeconds: number };

/** Segundos hasta poder lanzar otra evaluación según la última creada desde la app (0 = ya). */
async function cooldownSeconds(): Promise<number> {
  const [row] = await db
    .select({ age: sql<number>`extract(epoch from (now() - max(${evalRuns.createdAt})))` })
    .from(evalRuns)
    .where(eq(evalRuns.origin, APP_ORIGIN));
  if (row?.age == null) return 0;
  return Math.max(0, Math.ceil(COOLDOWN_SECONDS - Number(row.age)));
}

async function markStaleAbandoned() {
  await db
    .update(evalRuns)
    .set({ status: "abandoned", finishedAt: sql`now()` })
    .where(
      and(
        eq(evalRuns.origin, APP_ORIGIN),
        eq(evalRuns.status, "running"),
        lt(evalRuns.createdAt, sql`now() - make_interval(mins => ${STALE_RUN_MINUTES})`),
      ),
    );
}

async function runningRun(): Promise<{ id: number } | undefined> {
  const [r] = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(and(eq(evalRuns.origin, APP_ORIGIN), eq(evalRuns.status, "running")))
    .limit(1);
  return r;
}

export async function createEvalRun(): Promise<CreateOutcome> {
  await markStaleAbandoned();
  const running = await runningRun();
  if (running) return { kind: "running", runId: running.id };
  const wait = await cooldownSeconds();
  if (wait > 0) return { kind: "cooldown", retryAfterSeconds: wait };

  const [run] = await db.insert(evalRuns).values({ origin: APP_ORIGIN, status: "running" }).returning();

  // Carrera entre dos POST simultáneos: gana la evaluación con el id menor; la otra se retira.
  const [earlier] = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.origin, APP_ORIGIN),
        inArray(evalRuns.status, ["running", "done"]),
        lt(evalRuns.id, run.id),
        sql`${evalRuns.createdAt} > now() - make_interval(secs => ${COOLDOWN_SECONDS})`,
      ),
    )
    .orderBy(asc(evalRuns.id))
    .limit(1);
  if (earlier) {
    await db.delete(evalRuns).where(eq(evalRuns.id, run.id));
    return { kind: "running", runId: earlier.id };
  }

  await db.insert(evalResults).values(
    STEP_PLAN.map((s) => ({
      runId: run.id,
      model: s.model.id,
      provider: s.model.provider,
      test: s.test,
      step: s.step,
      status: "pending",
    })),
  );
  return { kind: "created", run: toRunDTO(run) };
}

// ---------- Ejecutar el siguiente paso ----------

export class EvalNotFoundError extends Error {}

export async function runNextStep(runId: number): Promise<StepResponse> {
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
  if (!run || run.origin !== APP_ORIGIN) throw new EvalNotFoundError();
  if (run.status !== "running") return { state: "finished" };

  const token = randomUUID();
  const locked = await db
    .update(evalRuns)
    .set({ lockedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`, lockToken: token })
    .where(
      and(
        eq(evalRuns.id, runId),
        eq(evalRuns.status, "running"),
        or(isNull(evalRuns.lockedUntil), lt(evalRuns.lockedUntil, sql`now()`)),
      ),
    )
    .returning({ id: evalRuns.id });
  if (locked.length === 0) return { state: "busy" };

  try {
    const [next] = await db
      .select()
      .from(evalResults)
      .where(and(eq(evalResults.runId, runId), eq(evalResults.status, "pending")))
      .orderBy(asc(evalResults.step))
      .limit(1);
    if (!next) {
      await finalize(runId);
      return { state: "finished" };
    }

    const plan = STEP_PLAN.find((s) => s.step === next.step);
    if (!plan) throw new Error("paso desconocido");
    const outcome = await runEvalStep(plan.model, plan.test);

    // Idempotente: solo escribe si el paso sigue pendiente.
    const [saved] = await db
      .update(evalResults)
      .set({
        status: "done",
        ok: outcome.ok,
        metrics: outcome.metrics as Record<string, unknown> | null,
        error: outcome.error,
        finishedAt: sql`now()`,
      })
      .where(and(eq(evalResults.id, next.id), eq(evalResults.status, "pending")))
      .returning();

    const [left] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(evalResults)
      .where(and(eq(evalResults.runId, runId), eq(evalResults.status, "pending")));
    if (!left || left.n === 0) await finalize(runId);

    return { state: "step_done", result: toResultDTO(saved ?? { ...next, ...outcome, status: "done", finishedAt: new Date() }) };
  } finally {
    await db
      .update(evalRuns)
      .set({ lockedUntil: null, lockToken: null })
      .where(and(eq(evalRuns.id, runId), eq(evalRuns.lockToken, token)))
      .catch(() => {
        /* el lease caduca solo */
      });
  }
}

async function finalize(runId: number) {
  await db
    .update(evalRuns)
    .set({ status: "done", finishedAt: sql`now()` })
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")));
}

// ---------- Vista general ----------

export async function getOverview(): Promise<EvalsOverview> {
  await markStaleAbandoned();

  const manual = await db.select().from(evalRuns).where(eq(evalRuns.origin, MANUAL_ORIGIN));
  const recentApp = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.origin, APP_ORIGIN))
    .orderBy(desc(evalRuns.id))
    .limit(15);
  const runs = [...recentApp, ...manual];
  const runById = new Map(runs.map((r) => [r.id, r]));
  const results = runs.length
    ? await db.select().from(evalResults).where(inArray(evalResults.runId, runs.map((r) => r.id)))
    : [];

  const byRun = new Map<number, ResultRow[]>();
  for (const r of results) byRun.set(r.runId, [...(byRun.get(r.runId) ?? []), r]);

  // Por modelo: la evaluación terminada más reciente en la que participó (sin pasos pendientes).
  const models: ModelRowDTO[] = EVAL_MODELS.map((m) => {
    const candidates = runs
      .filter((r) => r.status === "done" || r.origin === MANUAL_ORIGIN)
      .filter((r) => (byRun.get(r.id) ?? []).some((x) => x.model === m.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const run = candidates[0];
    const row: ModelRowDTO = { id: m.id, label: m.label, provider: m.provider, finalist: m.finalist, run: null, results: {} };
    if (!run) return row;
    row.run = toRunDTO(runById.get(run.id)!);
    for (const x of byRun.get(run.id) ?? []) {
      if (x.model === m.id && (EVAL_TESTS as readonly string[]).includes(x.test)) row.results[x.test as EvalTest] = toResultDTO(x);
    }
    return row;
  });

  const activeRun = recentApp.find((r) => r.status === "running");
  let active: EvalsOverview["active"] = null;
  if (activeRun) {
    const steps = (byRun.get(activeRun.id) ?? []).sort((a, b) => a.step - b.step).map(toResultDTO);
    const busy = activeRun.lockedUntil ? await isFuture(activeRun.id) : false;
    active = { run: toRunDTO(activeRun), steps, busy };
  }

  return { models, active, cooldownSeconds: await cooldownSeconds() };
}

async function isFuture(runId: number): Promise<boolean> {
  const rows = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(and(eq(evalRuns.id, runId), sql`${evalRuns.lockedUntil} > now()`));
  return rows.length > 0;
}
