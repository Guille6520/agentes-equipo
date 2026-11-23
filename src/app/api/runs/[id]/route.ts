import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, events, files, runs, tasks } from "@/db";
import type { RunDetailResponse } from "@/lib/types";
import { toEventDTO, toFileDTO, toRunDTO, toTaskDTO } from "../_serialize";

// Dinámico por defecto (GET sin caché). Ver nota en ../route.ts.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, ctx: RouteContext<"/api/runs/[id]">) {
  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Identificador no válido." }, { status: 400, headers: NO_STORE });
  }

  const afterParam = request.nextUrl.searchParams.get("after");
  const after = afterParam === null ? null : Number(afterParam);
  if (after !== null && (!Number.isInteger(after) || after < 0)) {
    return Response.json({ error: "Parámetro 'after' no válido." }, { status: 400, headers: NO_STORE });
  }

  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
    if (!run) {
      return Response.json({ error: "Ejecución no encontrada." }, { status: 404, headers: NO_STORE });
    }

    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.runId, id))
      .orderBy(asc(tasks.id));

    const [fileRows, eventRows] = await Promise.all([
      taskRows.length
        ? db
            .select()
            .from(files)
            .where(inArray(files.taskId, taskRows.map((t) => t.id)))
            .orderBy(asc(files.taskId), asc(files.path), asc(files.version))
        : Promise.resolve([]),
      db
        .select()
        .from(events)
        .where(
          after === null ? eq(events.runId, id) : and(eq(events.runId, id), gt(events.id, after)),
        )
        .orderBy(asc(events.id)),
    ]);

    const body: RunDetailResponse = {
      run: toRunDTO(run),
      tasks: taskRows.map(toTaskDTO),
      files: fileRows.map(toFileDTO),
      events: eventRows.map(toEventDTO),
    };
    return Response.json(body, { headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "No se pudo leer la ejecución." },
      { status: 500, headers: NO_STORE },
    );
  }
}
