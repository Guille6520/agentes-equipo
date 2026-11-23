import type { TaskDTO } from "@/lib/types";
import { AGENTS, TASK_COLUMNS } from "./meta";

interface Props {
  tasks: TaskDTO[];
  selectedTaskId: number | null;
  onSelect: (id: number) => void;
}

export function KanbanBoard({ tasks, selectedTaskId, onSelect }: Props) {
  return (
    <section aria-labelledby="kanban-title">
      <h2 id="kanban-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Tablero de tareas
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <span className={`size-2 rounded-full ${col.dot}`} aria-hidden="true" />
                  {col.label}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${col.badge}`}
                  aria-label={`${items.length} tareas`}
                >
                  {items.length}
                </span>
              </div>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                  {col.empty}
                </p>
              ) : (
                <ul className="space-y-2">
                  {items.map((t) => {
                    const selected = t.id === selectedTaskId;
                    return (
                      <li key={t.id} className="animate-[card-in_0.4s_ease-out]">
                        <button
                          type="button"
                          onClick={() => onSelect(t.id)}
                          aria-pressed={selected}
                          className={`w-full rounded-xl border bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-3 text-left transition duration-300 hover:-translate-y-0.5 hover:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                            selected ? "border-violet-400/60 ring-1 ring-violet-400/40" : "border-white/10"
                          }`}
                        >
                          <span className="block text-sm font-medium text-slate-100">{t.title}</span>
                          <span className="mt-1 line-clamp-2 block text-xs text-slate-400">{t.description}</span>
                          <span className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                            <span className="rounded-md bg-slate-950/60 px-1.5 py-0.5">
                              {t.attempts} {t.attempts === 1 ? "intento" : "intentos"}
                            </span>
                          </span>
                          {t.lastFeedback && (
                            <span
                              className={`mt-2 block rounded-lg border-l-2 bg-slate-950/50 px-2 py-1.5 text-xs ${
                                t.status === "failed" ? "border-rose-400 text-rose-200" : "border-emerald-400 text-slate-300"
                              }`}
                            >
                              <span className={`font-medium ${AGENTS.testing.text}`}>Testing: </span>
                              {t.lastFeedback}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
