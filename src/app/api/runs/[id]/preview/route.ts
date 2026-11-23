import { asc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, files, runs, tasks } from "@/db";
import {
  newNonce,
  preparePreview,
  previewHeaders,
  renderPreviewDocument,
  type PreparedPreview,
  type PreviewFile,
} from "@/lib/preview/build";
import { redact } from "@/lib/security/redact";

// GET /api/runs/[id]/preview?task=<taskId>
// Devuelve un documento HTML que ejecuta en el NAVEGADOR (iframe sandbox, ver src/lib/preview/build.ts)
// la última versión de los archivos generados. Protegida por el login: src/proxy.ts exige sesión en
// todo /api/*. Dinámica por defecto (GET sin caché), como el resto de /api/runs.

function page(prepared: PreparedPreview, status = 200, caption?: string) {
  const nonce = newNonce();
  // Los errores (p. ej. de compilación) salen al navegador: sin secretos.
  if (!prepared.ok) prepared = { ...prepared, title: redact(prepared.title), detail: redact(prepared.detail) };
  return new Response(renderPreviewDocument({ nonce, prepared, caption }), previewHeaders(nonce, status));
}

const fail = (title: string, detail: string, status: number) => page({ ok: false, title, detail }, status);

export async function GET(request: NextRequest, ctx: RouteContext<"/api/runs/[id]/preview">) {
  const { id: rawId } = await ctx.params;
  const runId = Number(rawId);
  if (!Number.isInteger(runId) || runId <= 0) return fail("Identificador no válido", `"${rawId}"`, 400);

  const taskParam = request.nextUrl.searchParams.get("task");
  const wantedTask = taskParam === null ? null : Number(taskParam);
  if (wantedTask !== null && (!Number.isInteger(wantedTask) || wantedTask <= 0)) {
    return fail("Parámetro 'task' no válido", `"${taskParam}"`, 400);
  }

  try {
    const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) return fail("Ejecución no encontrada", `No existe la ejecución ${runId}.`, 404);

    // Solo las columnas necesarias (no depende de columnas nuevas del esquema).
    const taskRows = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.runId, runId))
      .orderBy(asc(tasks.id));
    const fileRows = taskRows.length
      ? await db
          .select({ taskId: files.taskId, path: files.path, content: files.content, version: files.version })
          .from(files)
          .where(inArray(files.taskId, taskRows.map((t) => t.id)))
          .orderBy(asc(files.taskId), asc(files.path), asc(files.version))
      : [];

    // Última versión de cada ruta, por tarea (llegan ordenados por versión ascendente).
    const latest = new Map<number, Map<string, { content: string; version: number }>>();
    for (const f of fileRows) {
      const m = latest.get(f.taskId) ?? new Map<string, { content: string; version: number }>();
      m.set(f.path, { content: f.content, version: f.version });
      latest.set(f.taskId, m);
    }
    const withFiles = taskRows.filter((t) => latest.has(t.id));

    // Tarea mostrada: la pedida; si no, la última aprobada con archivos; si no, la última con archivos.
    const target =
      wantedTask !== null
        ? taskRows.find((t) => t.id === wantedTask)
        : (withFiles.filter((t) => t.status === "passed").at(-1) ?? withFiles.at(-1));
    if (!target) {
      return wantedTask !== null
        ? fail("Tarea no encontrada", `La tarea ${wantedTask} no pertenece a la ejecución ${runId}.`, 404)
        : fail("Aún no hay archivos", "Los agentes todavía no han generado código en esta ejecución.", 404);
    }
    const own = latest.get(target.id);
    if (!own) return fail("Aún no hay archivos", `La tarea «${target.title}» todavía no ha generado código.`, 404);

    const toList = (m: Map<string, { content: string }>): PreviewFile[] =>
      [...m].map(([path, { content }]) => ({ path, content }));
    // Igual que Develop: puede importar los archivos aprobados de tareas anteriores.
    const deps = taskRows
      .filter((t) => t.id < target.id && t.status === "passed")
      .flatMap((t) => toList(latest.get(t.id) ?? new Map()));

    const version = Math.max(...[...own.values()].map((f) => f.version));
    const state = target.status === "passed" ? "aprobada por Testing" : "sin aprobar todavía";
    return page(preparePreview(toList(own), deps), 200, `Vista previa · «${target.title}» · versión ${version} · ${state}`);
  } catch {
    return fail("No se pudo generar la vista previa", "Error al leer la ejecución de la base de datos.", 500);
  }
}
