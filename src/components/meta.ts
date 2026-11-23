import type { AgentId, TaskStatus } from "@/lib/types";

/** Clases Tailwind estáticas (deben ser literales para que Tailwind las genere). */
export const AGENTS: Record<
  AgentId,
  {
    label: string;
    role: string;
    text: string;
    badge: string;
    dot: string;
    ring: string;
    glow: string;
    gradient: string;
  }
> = {
  orchestrator: {
    label: "Orquestador",
    role: "Planifica y reparte las tareas",
    text: "text-violet-300",
    badge: "bg-violet-500/15 text-violet-300 ring-violet-400/30",
    dot: "bg-violet-400",
    ring: "border-violet-500/40",
    glow: "shadow-violet-500/10",
    gradient: "from-violet-500/10",
  },
  develop: {
    label: "Develop",
    role: "Escribe el código de cada tarea",
    text: "text-blue-300",
    badge: "bg-blue-500/15 text-blue-300 ring-blue-400/30",
    dot: "bg-blue-400",
    ring: "border-blue-500/40",
    glow: "shadow-blue-500/10",
    gradient: "from-blue-500/10",
  },
  testing: {
    label: "Testing",
    role: "Revisa y valida el resultado",
    text: "text-emerald-300",
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    dot: "bg-emerald-400",
    ring: "border-emerald-500/40",
    glow: "shadow-emerald-500/10",
    gradient: "from-emerald-500/10",
  },
};

export const TASK_COLUMNS: {
  status: TaskStatus;
  label: string;
  badge: string;
  dot: string;
  empty: string;
}[] = [
  {
    status: "pending",
    label: "Pendiente",
    badge: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
    dot: "bg-slate-400",
    empty: "Sin tareas pendientes",
  },
  {
    status: "running",
    label: "En curso",
    badge: "bg-sky-500/15 text-sky-300 ring-sky-400/30",
    dot: "bg-sky-400",
    empty: "Nada en curso ahora mismo",
  },
  {
    status: "failed",
    label: "Fallida",
    badge: "bg-rose-500/15 text-rose-300 ring-rose-400/30",
    dot: "bg-rose-400",
    empty: "Ninguna tarea fallida",
  },
  {
    status: "passed",
    label: "Aprobada",
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    dot: "bg-emerald-400",
    empty: "Aún no hay tareas aprobadas",
  },
];

export const RUN_STATUS_LABEL = {
  running: { label: "En curso", badge: "bg-sky-500/15 text-sky-300 ring-sky-400/30" },
  passed: { label: "Completada", badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" },
  failed: { label: "Fallida", badge: "bg-rose-500/15 text-rose-300 ring-rose-400/30" },
} as const;

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
