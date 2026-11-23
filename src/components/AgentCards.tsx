import type { AgentId, EventDTO, RunDTO, TaskDTO } from "@/lib/types";
import { AGENTS, formatTime } from "./meta";

interface Props {
  run: RunDTO | null;
  tasks: TaskDTO[];
  events: EventDTO[];
}

/**
 * Estado derivado de los datos (no hay estado explícito por agente en BD):
 * - Develop/Testing están activos si hay una tarea "running"; entre los dos, el
 *   que haya emitido el último evento de esa tarea (por defecto Develop).
 * - El Orquestador está activo mientras el run está en curso y no hay ninguna
 *   tarea en ejecución (planificando o coordinando).
 */
function activeAgents(run: RunDTO | null, tasks: TaskDTO[], events: EventDTO[]): Set<AgentId> {
  const active = new Set<AgentId>();
  if (!run || run.status !== "running") return active;
  const running = tasks.filter((t) => t.status === "running");
  if (running.length === 0) {
    active.add("orchestrator");
    return active;
  }
  for (const t of running) {
    const last = [...events].reverse().find((e) => e.taskId === t.id && e.agent !== "orchestrator");
    active.add(last?.agent === "testing" ? "testing" : "develop");
  }
  return active;
}

export function AgentCards({ run, tasks, events }: Props) {
  const active = activeAgents(run, tasks, events);
  const order: AgentId[] = ["orchestrator", "develop", "testing"];

  return (
    <section aria-labelledby="agents-title">
      <h2 id="agents-title" className="sr-only">
        Agentes
      </h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {order.map((id) => {
          const a = AGENTS[id];
          const isActive = active.has(id);
          const last = [...events].reverse().find((e) => e.agent === id);
          return (
            <li
              key={id}
              className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${a.gradient} to-slate-900/40 p-4 shadow-lg transition-all duration-500 ${
                isActive ? `${a.ring} ${a.glow} shadow-xl` : "border-white/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className={`text-base font-semibold ${a.text}`}>{a.label}</h3>
                  <p className="text-xs text-slate-400">{a.role}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors duration-500 ${
                    isActive ? a.badge : "bg-slate-500/10 text-slate-400 ring-slate-500/20"
                  }`}
                >
                  <span className="relative flex size-2" aria-hidden="true">
                    {isActive && (
                      <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${a.dot}`} />
                    )}
                    <span className={`relative inline-flex size-2 rounded-full ${isActive ? a.dot : "bg-slate-500"}`} />
                  </span>
                  {isActive ? "Activo" : "Esperando"}
                </span>
              </div>
              <div className="mt-4 min-h-[3.5rem] rounded-lg bg-slate-950/50 p-3 text-sm">
                {last ? (
                  <>
                    <p className="line-clamp-3 text-slate-200">{last.message}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      <time dateTime={last.createdAt}>{formatTime(last.createdAt)}</time>
                    </p>
                  </>
                ) : (
                  <p className="text-slate-500">Sin actividad todavía</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
