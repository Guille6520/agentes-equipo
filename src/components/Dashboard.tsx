"use client";

import { useState } from "react";
import { useRun } from "@/hooks/useRun";
import { AgentCards } from "./AgentCards";
import { EventLog } from "./EventLog";
import { FileViewer } from "./FileViewer";
import { Header } from "./Header";
import { KanbanBoard } from "./KanbanBoard";

export function Dashboard() {
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const { runs, runId, run, tasks, files, events, loading, error, refresh } = useRun(selectedRun);

  // Tarea mostrada en el visor: la elegida, si no la que está en curso, si no la primera.
  const task =
    tasks.find((t) => t.id === selectedTask) ?? tasks.find((t) => t.status === "running") ?? tasks[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        runs={runs}
        currentId={runId}
        onSelect={(id) => {
          setSelectedRun(id);
          setSelectedTask(null);
        }}
        onCreated={(id) => {
          setSelectedRun(id);
          setSelectedTask(null);
          refresh();
        }}
      />
      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            <span>No se pudieron cargar los datos: {error}</span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-md bg-rose-500/20 px-3 py-1 font-medium hover:bg-rose-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading ? (
          <div role="status" aria-live="polite" className="space-y-6">
            <span className="sr-only">Cargando…</span>
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-900/70" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-2xl bg-slate-900/70" />
          </div>
        ) : !run ? (
          !error && (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-20 text-center">
              <p className="text-lg font-medium text-slate-200">Aún no hay ejecuciones</p>
              <p className="mt-1 text-sm text-slate-400">
                Escribe una petición arriba para que el equipo de agentes empiece a trabajar.
              </p>
            </div>
          )
        ) : (
          <>
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">Petición: </span>
              {run.request}
            </p>
            <AgentCards run={run} tasks={tasks} events={events} />
            <KanbanBoard tasks={tasks} selectedTaskId={task?.id ?? null} onSelect={setSelectedTask} />
            <div className="grid gap-6 lg:grid-cols-2">
              <EventLog events={events} />
              <FileViewer task={task} files={files} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
