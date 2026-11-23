// Develop: genera (o corrige) los archivos TSX de una tarea y la pasa a Testing.
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db, events, files, runs, tasks } from "@/db";
import { callModel, parseJson } from "@/lib/ai/generate";
import { injectDemoDefect } from "./demo-defect";
import type { Lease } from "./lease";
import { dependencyFiles, eventValues, filesOfVersion, logEvent, secs, type TaskRow } from "./shared";

// Rutas planas bajo components/ e imports relativos: el sandbox de Testing solo resuelve imports
// relativos entre los archivos generados (no hay alias @/ ni paquetes de Next en el sandbox).
const PATH_RE = /^components\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.tsx?$/;

const outputSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().trim().regex(PATH_RE, "ruta no permitida (usa components/Nombre.tsx)"),
        content: z.string().min(20).max(40_000),
      }),
    )
    .min(1)
    .max(4)
    .refine((fs) => fs.some((f) => f.path.endsWith(".tsx")), "debe haber al menos un .tsx")
    .refine((fs) => new Set(fs.map((f) => f.path)).size === fs.length, "rutas repetidas"),
});

const INSTRUCTIONS = `Eres Develop, un programador experto en React 19 + TypeScript estricto.
Implementa la tarea creando archivos .tsx. Reglas obligatorias:
- Rutas dentro de components/, p. ej. components/ContactForm.tsx. Imports entre archivos SOLO relativos ("./ContactForm").
- Solo puedes importar de "react" y de los archivos generados. Nada de next/*, alias @/, librerías externas ni CSS.
- El archivo principal de la tarea hace "export default" de un componente que renderiza sin props obligatorias.
- Si es cliente con estado, añade "use client" al principio.
- Accesibilidad: cada input/textarea/select con <label htmlFor> asociado a su id; botones con texto; img con alt; sin tabIndex positivo; aria-* válidos.
- Formularios: <form onSubmit> con preventDefault, campos con name/id (name, email, message), email con type="email", required, y una región role="alert" o aria-live para errores/éxito. No envíes datos a servidores externos (simula el envío).
- Seguridad: sin dangerouslySetInnerHTML, eval, new Function, claves ni fetch a dominios externos.
- Estilos con clases de Tailwind en className.
- TypeScript estricto: tipa eventos (React.FormEvent<HTMLFormElement>, React.ChangeEvent<...>) y estado.
Formato de respuesta (sin nada más antes ni después), un bloque por archivo:
<file path="components/Nombre.tsx">
...código completo del archivo...
</file>`;

// DESVÍO del diseño (JSON {files:[{path,content}]}): en el e2e real Laguna devolvía el código dentro
// de cadenas JSON sin escapar los saltos de línea ("JSON mal formado" en 4 de 4 llamadas), lo que
// forzaba el respaldo siempre. Se pide el código en bloques <file path="..."> (sin escapes) y se
// convierte al MISMO objeto {files:[{path,content}]} validado con zod. Si un modelo responde en JSON,
// también se acepta.
export function parseDevelopOutput(text: string): z.infer<typeof outputSchema> {
  const blocks = [...text.matchAll(/<file\s+path\s*=\s*"([^"]+)"\s*>\r?\n?([\s\S]*?)<\/file>/g)];
  if (blocks.length === 0) return parseJson(outputSchema, text);
  const files = blocks.map(([, path, body]) => ({
    path: path.trim(),
    // Quita una valla de markdown si el modelo envolvió el código en ```tsx ... ```.
    content: body.replace(/^\s*```[\w-]*\r?\n/, "").replace(/\r?\n?```\s*$/, "").trimEnd() + "\n",
  }));
  const parsed = outputSchema.safeParse({ files });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`no cumple el esquema: ${issue?.path.join(".") || "raíz"} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}

function renderFiles(list: { path: string; content: string }[]) {
  return list.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join("\n\n");
}

export async function developTask(run: typeof runs.$inferSelect, task: TaskRow, runTasks: TaskRow[], lease: Lease) {
  const attempt = task.attempts + 1;
  const fixing = task.attempts > 0 && task.lastFeedback;

  // Marca la tarea en curso (visible en el tablero) antes de la llamada larga al modelo.
  await db.batch([
    db.update(tasks).set({ status: "running", updatedAt: new Date() }).where(eq(tasks.id, task.id)),
    db.insert(events).values(
      eventValues(
        run.id,
        "develop",
        fixing
          ? `Corrigiendo «${task.title}» con el feedback de Testing (intento ${attempt}).`
          : `Generando código para «${task.title}» (intento ${attempt}).`,
        task.id,
      ),
    ),
  ]);

  const deps = await dependencyFiles(runTasks, task);
  const previous = fixing ? await filesOfVersion(task.id, task.attempts) : [];

  const parts = [
    `Petición original del usuario: ${run.request}`,
    `Tarea: ${task.title}\n${task.description}`,
  ];
  if (deps.length) {
    parts.push(
      `Archivos ya aprobados de tareas anteriores (puedes importarlos con rutas relativas; no los reescribas):\n${renderFiles(deps)}`,
    );
  }
  if (fixing) {
    parts.push(`Tu entrega anterior (intento ${task.attempts}):\n${renderFiles(previous)}`);
    parts.push(`Feedback de Testing que DEBES corregir:\n${task.lastFeedback}`);
    parts.push("Devuelve la versión corregida completa de los archivos.");
  }

  const result = await callModel({
    role: "develop",
    instructions: INSTRUCTIONS,
    prompt: parts.join("\n\n"),
    maxOutputTokens: 8192,
    parse: parseDevelopOutput,
    onFallback: ({ from, to, reason }) =>
      logEvent(run.id, "develop", `${from.label} falla (${reason}); uso ${to.label} como respaldo.`, task.id),
  });

  // No sobrescribir archivos de tareas anteriores: si el modelo los repite, se descartan.
  const depPaths = new Set(deps.map((d) => d.path));
  const own = result.data.files.filter((f) => !depPaths.has(f.path));
  let delivered = own.length > 0 ? own : result.data.files;

  // Modo demo: en el primer intento de UNA sola tarea se introduce a propósito un defecto real
  // (post-procesado determinista, el modelo no interviene) para que Testing lo detecte. Se elige la
  // primera tarea cuyo código tenga un campo de formulario; si ninguna lo tiene, en la última tarea se
  // usa una imagen sin alt. El evento queda registrado: no se disfraza de error del modelo.
  let demoNote: string | null = null;
  if (run.demoForceFailure && attempt === 1) {
    const already = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.runId, run.id), like(events.message, "Modo demo:%")))
      .limit(1);
    if (already.length === 0) {
      const isLast = !runTasks.some((t) => t.id > task.id);
      const defect = injectDemoDefect(delivered, isLast);
      if (defect) {
        delivered = defect.files;
        demoNote = `Modo demo: se ha introducido a propósito un defecto (${defect.description}) en la entrega de «${task.title}» para mostrar el bucle de corrección. No es un error del modelo.`;
      }
    }
  }

  await lease.assertHeld();
  // Escritura atómica (neon-http ejecuta el batch como transacción): archivos con versión = número
  // de intento + avance de la tarea. Si el paso muere antes, no queda nada a medias y el siguiente
  // avance repite este intento con el mismo número.
  await db.batch([
    db.insert(files).values(delivered.map((f) => ({ taskId: task.id, path: f.path, content: f.content, version: attempt }))),
    db
      .update(tasks)
      .set({ attempts: attempt, phase: "testing", status: "running", updatedAt: new Date() })
      .where(eq(tasks.id, task.id)),
    db.update(runs).set({ stepErrors: 0 }).where(eq(runs.id, run.id)),
    db.insert(events).values([
      ...(demoNote ? [eventValues(run.id, "develop", demoNote, task.id)] : []),
      eventValues(
        run.id,
        "develop",
        `Entregado ${delivered.map((f) => f.path).join(", ")} (intento ${attempt}, ${result.model.label}${
          result.usedFallback ? " de respaldo" : ""
        }, ${secs(result.ms)}). Pasa a Testing.`,
        task.id,
      ),
    ]),
  ]);
}
