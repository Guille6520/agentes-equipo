// Prueba extremo a extremo del motor con modelos reales.
// Uso: npx tsx scripts/e2e-engine.ts ["petición opcional"]
// Lee .env.local (DATABASE_URL, NVIDIA_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY) y NO imprime ninguna
// de esas variables. Crea un run nuevo (no toca el run de demo), llama a advanceRun en bucle y sale
// con código distinto de 0 si el run no termina en "passed".
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const REQUEST = process.argv[2] ?? "Añade una página de contacto a esta web";
const MAX_STEPS = 40;
const MAX_TOTAL_MS = 20 * 60_000;

async function main() {
  for (const k of ["DATABASE_URL", "NVIDIA_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
    if (!process.env[k]) console.warn(`Aviso: falta ${k} en .env.local`);
  }
  if (!process.env.DATABASE_URL) process.exit(1);

  const { asc, eq } = await import("drizzle-orm");
  const { db, runs, tasks, files, events } = await import("../src/db");
  const { advanceRun } = await import("../src/lib/engine");

  const [run] = await db.insert(runs).values({ request: REQUEST, status: "running", engineManaged: true }).returning();
  await db.insert(events).values({ runId: run.id, agent: "orchestrator", message: "Petición recibida" });
  console.log(`Run #${run.id}: "${REQUEST}"\n`);

  const t0 = Date.now();
  let lastEventId = 0;
  let step = 0;
  for (; step < MAX_STEPS && Date.now() - t0 < MAX_TOTAL_MS; step++) {
    const ts = Date.now();
    const r = await advanceRun(run.id);
    const fresh = await db.select().from(events).where(eq(events.runId, run.id)).orderBy(asc(events.id));
    for (const e of fresh.filter((e) => e.id > lastEventId)) console.log(`  [${e.agent}] ${e.message}`);
    lastEventId = fresh.at(-1)?.id ?? lastEventId;
    console.log(`paso ${step + 1}: ${r.outcome} (${((Date.now() - ts) / 1000).toFixed(1)} s)\n`);
    if (!r.more) break;
    if (r.outcome === "busy" || r.outcome === "error") await new Promise((res) => setTimeout(res, 3000));
  }

  const [final] = await db.select().from(runs).where(eq(runs.id, run.id));
  const taskRows = await db.select().from(tasks).where(eq(tasks.runId, run.id)).orderBy(asc(tasks.id));
  const evs = await db.select().from(events).where(eq(events.runId, run.id)).orderBy(asc(events.id));
  const totalS = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("================ RESUMEN ================");
  console.log(`Run #${final.id}: ${final.status} | pasos: ${step + 1} | tiempo total: ${totalS} s`);
  for (const t of taskRows) {
    const fs = await db.select({ path: files.path, version: files.version }).from(files).where(eq(files.taskId, t.id));
    const latest = fs.filter((f) => f.version === t.attempts).map((f) => f.path);
    console.log(`- [${t.status}] ${t.title} | intentos: ${t.attempts} | checks: ${t.checkProfile} | archivos: ${latest.join(", ")}`);
  }
  const fallbacks = evs.filter((e) => /respaldo/.test(e.message));
  const models = [...new Set(evs.flatMap((e) => e.message.match(/gemini-[\w.-]+|laguna-[\w.-]+/g) ?? []))];
  console.log(`Modelos mencionados: ${models.join(", ") || "ninguno"}`);
  console.log(`Eventos con respaldo/fallback: ${fallbacks.length}`);
  for (const f of fallbacks) console.log(`  · [${f.agent}] ${f.message}`);
  console.log(`Eventos totales: ${evs.length}`);

  process.exit(final.status === "passed" ? 0 : 1);
}

main().catch((e) => {
  console.error("Error en el e2e:", e instanceof Error ? e.message : e);
  process.exit(1);
});
