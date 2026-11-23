// Orquestador: divide la petición en 2-4 tareas que producen archivos TSX.
import { z } from "zod";
import { db, events, runs, tasks } from "@/db";
import { callModel, parseJson } from "@/lib/ai/generate";
import type { Lease } from "./lease";
import { eventValues, logEvent, profileFor, profileLabel, secs } from "./shared";
import { eq } from "drizzle-orm";

const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(10).max(1200),
      }),
    )
    .min(2)
    .max(4),
});

const INSTRUCTIONS = `Eres el Orquestador de un equipo de agentes que programa componentes React con TypeScript (TSX).
Divide la petición del usuario en entre 2 y 4 tareas, en orden de dependencia.
Reglas:
- Cada tarea debe producir uno o más archivos .tsx con un componente React que se pueda renderizar solo.
- No crees tareas de tests, backend, despliegue, configuración ni solo de estilos.
- Si hay un formulario, dedica una tarea a él e indica en su descripción los campos (nombre, email, mensaje) y la validación.
- Las tareas posteriores pueden reutilizar componentes de las anteriores; dilo en la descripción (nombre del componente).
- Título corto en español; descripción concreta en español con criterios de aceptación.
Responde SOLO con JSON, sin texto adicional: {"tasks":[{"title":"...","description":"..."}]}`;

export async function planRun(run: typeof runs.$inferSelect, lease: Lease) {
  await logEvent(run.id, "orchestrator", "Analizando la petición y dividiéndola en tareas…");

  const result = await callModel({
    role: "orchestrator",
    instructions: INSTRUCTIONS,
    prompt: `Petición: ${run.request}`,
    maxOutputTokens: 2048,
    parse: (text) => parseJson(planSchema, text),
    onFallback: ({ from, to, reason }) =>
      logEvent(run.id, "orchestrator", `${from.label} falla (${reason}); uso ${to.label} como respaldo.`),
  });

  const plan = result.data.tasks.map((t) => ({ ...t, checkProfile: profileFor(t.title, t.description) }));
  await lease.assertHeld();

  // Inserción atómica (neon-http ejecuta el batch como una transacción): o se crean todas las
  // tareas y sus eventos, o ninguna, así un reintento del paso no duplica el plan.
  const inserted = await db.batch([
    db.insert(tasks).values(plan.map((t) => ({ runId: run.id, ...t }))).returning(),
    db.update(runs).set({ stepErrors: 0 }).where(eq(runs.id, run.id)),
    db.insert(events).values(
      eventValues(
        run.id,
        "orchestrator",
        `Plan listo: ${plan.length} tareas (${result.model.label}${result.usedFallback ? ", respaldo" : ""}, ${secs(result.ms)}).`,
      ),
    ),
  ]);
  const created = inserted[0];
  await db.insert(events).values(
    created.map((t, i) =>
      eventValues(run.id, "orchestrator", `Tarea ${i + 1} asignada a Develop: ${t.title} (checks: ${profileLabel(t.checkProfile)}).`, t.id),
    ),
  );
}
