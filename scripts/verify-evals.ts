// Verificación del flujo de evaluaciones sin HTTP (el login bloquea la API). Llama a los modelos reales: 1 evaluación completa.
// Uso: npx tsx scripts/verify-evals.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { sql, eq } = await import("drizzle-orm");
  const { db, runs, tasks, files, events, evalRuns } = await import("../src/db");
  const svc = await import("../src/lib/evals/service");
  const counts = async () => {
    const c = async (t: typeof runs | typeof tasks | typeof files | typeof events) => Number((await db.select({ n: sql<number>`count(*)` }).from(t))[0].n);
    return { runs: await c(runs), tasks: await c(tasks), files: await c(files), events: await c(events) };
  };
  const before = await counts();
  console.log("agentes antes", before);

  // Solo para la prueba: retrasa 11 min las evaluaciones de la app previas para saltar el límite.
  await db.update(evalRuns).set({ createdAt: sql`now() - interval '11 minutes'` }).where(eq(evalRuns.origin, "app"));
  const a = await svc.createEvalRun();
  console.log("1) crear:", a.kind);
  if (a.kind !== "created") throw new Error("esperaba created");
  const id = a.run.id;
  const b = await svc.createEvalRun();
  console.log("2) crear con una en curso:", b.kind);

  // Concurrencia: dos pasos a la vez -> uno ejecuta y el otro "busy".
  const [x, y] = await Promise.all([svc.runNextStep(id), svc.runNextStep(id)]);
  console.log("3) concurrentes:", x.state, y.state);

  for (;;) {
    const r = await svc.runNextStep(id);
    if (r.state === "finished") { console.log("fin"); break; }
    if (r.state === "step_done") { /* seguir */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const ov = await svc.getOverview();
  for (const m of ov.models.filter((m) => m.finalist)) {
    console.log(m.label, m.run?.origin);
    for (const t of ["orchestrator", "develop", "testing"] as const) {
      const r = m.results[t];
      console.log("  ", t, JSON.stringify({ ok: r?.ok, err: r?.error, m: r?.metrics }));
    }
  }
  console.log("activo tras terminar:", ov.active, "cooldown s:", ov.cooldownSeconds);
  const c = await svc.createEvalRun();
  console.log("4) crear tras terminar:", c.kind, c.kind === "cooldown" ? c.retryAfterSeconds : "");

  // Simula que pasaron 11 min (solo mi tabla) y comprueba que se vuelve a permitir.
  await db.update(evalRuns).set({ createdAt: sql`now() - interval '11 minutes'` }).where(eq(evalRuns.id, id));
  const d = await svc.createEvalRun();
  console.log("5) crear tras 11 min:", d.kind);
  if (d.kind === "created") await db.update(evalRuns).set({ status: "abandoned" }).where(eq(evalRuns.id, d.run.id));
  const after = await counts();
  console.log("agentes despues", after, JSON.stringify(before) === JSON.stringify(after) ? "SIN CAMBIOS" : "CAMBIO!");
}
main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : e); process.exit(1); });
