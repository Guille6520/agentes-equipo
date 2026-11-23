// Orquestador: divide la petición en 1-4 tareas que producen archivos TSX (una petición pequeña
// puede ser una sola tarea; antes se exigían 2 y los modelos, con razón, devolvían 1).
import { z } from "zod";
import { db, events, runs, tasks } from "@/db";
import { callModel, parseJson } from "@/lib/ai/generate";
import type { Lease } from "./lease";
import { parseAcceptance } from "@/lib/testing/acceptance";
import { describeCriterion } from "@/lib/testing/acceptance-describe";
import { eventValues, logEvent, profileFor, profileLabel, secs } from "./shared";
import { eq } from "drizzle-orm";

const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(10).max(1200),
        // Se valida criterio a criterio con parseAcceptance: uno inválido se descarta sin tumbar el plan.
        acceptance: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(4),
});

const INSTRUCTIONS = `Eres el Orquestador de un equipo de agentes que programa componentes React con TypeScript (TSX).
Divide la petición del usuario en entre 1 y 4 tareas, en orden de dependencia.
Usa una sola tarea si la petición es pequeña y cabe en un único componente; no inventes tareas de relleno.
Reglas:
- Cada tarea debe producir uno o más archivos .tsx con un componente React que se pueda renderizar solo.
- No crees tareas de tests, backend, despliegue, configuración ni solo de estilos.
- Si hay un formulario, dedica una tarea a él e indica en su descripción los campos (nombre, email, mensaje) y la validación.
- Las tareas posteriores pueden reutilizar componentes de las anteriores; dilo en la descripción (nombre del componente).
- Título corto en español; descripción concreta en español.
- Cada tarea lleva "acceptance": de 1 a 5 criterios que Testing comprobará automáticamente en el HTML del
  componente renderizado en su estado inicial (sin clics ni envíos). Usa SOLO estos tipos:
  {"type":"text","value":"Enviar"}                texto visible que debe aparecer
  {"type":"element","selector":"li","min":3}      elementos HTML; selector: form, button, input, textarea, select, label, a, img, h1-h6, p, nav, header, footer, main, section, article, ul, ol, li, table, tr, th, td, o input[type=email|tel|checkbox|...]; "min" opcional
  {"type":"field","name":"email","required":true} campo de formulario con ese name; "required" opcional
  {"type":"heading","text":"Contacto"}            encabezado h1-h6 que contiene ese texto ("level" opcional, 1-6)
  {"type":"link","text":"Inicio"}                 enlace <a> que contiene ese texto
  Criterios concretos y cortos, coherentes con la descripción; no pidas mensajes que solo aparecen tras enviar.
Ejemplo: {"tasks":[{"title":"Formulario de contacto","description":"...","acceptance":[{"type":"heading","text":"Contacto"},{"type":"field","name":"email","required":true},{"type":"element","selector":"textarea"},{"type":"text","value":"Enviar"}]}]}
Responde SOLO con JSON, sin texto adicional: {"tasks":[{"title":"...","description":"...","acceptance":[...]}]}`;

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

  let discarded = 0;
  const plan = result.data.tasks.map(({ acceptance: raw, ...t }) => {
    const parsed = parseAcceptance(raw);
    discarded += parsed.discarded;
    return {
      ...t,
      checkProfile: profileFor(t.title, t.description),
      acceptance: parsed.criteria.length ? parsed.criteria : null,
    };
  });
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
        `Plan listo: ${plan.length} tareas (${result.model.label}${result.usedFallback ? ", respaldo" : ""}, ${secs(result.ms)}).${
          discarded ? ` Descartados ${discarded} criterios de aceptación (no válidos, repetidos o por encima de 5 por tarea).` : ""
        }`,
      ),
    ),
  ]);
  const created = inserted[0];
  await db.insert(events).values(
    created.map((t, i) =>
      eventValues(
        run.id,
        "orchestrator",
        `Tarea ${i + 1} → Develop: ${t.title} (checks: ${profileLabel(t.checkProfile)}) · ${
          t.acceptance?.length
            ? `Testing verificará: ${t.acceptance.map(describeCriterion).join(", ")}.`
            : "sin criterios de aceptación propios (solo checks generales)."
        }`,
        t.id,
      ),
    ),
  );
}
