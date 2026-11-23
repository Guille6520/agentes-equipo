import type { EvalMetrics, EvalResultDTO, ModelRowDTO } from "@/lib/evals/types";
import type { EvalTest } from "@/lib/evals/models";

export const MANUAL_ORIGIN_PREFIX = "manual";

export const PROVIDER_LABEL: Record<string, string> = { nvidia: "NVIDIA", google: "Google", groq: "Groq" };

export function fmtMs(ms: number | null | undefined, approx = false): string {
  if (ms == null) return "—";
  const v = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return approx ? `~${v}` : v;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function originBadge(origin: string, createdAt: string): { label: string; className: string; date: string } {
  if (origin.startsWith(MANUAL_ORIGIN_PREFIX)) {
    const label = origin.includes("groq") ? "Manual Groq 23/11" : "Manual 23/11";
    return { label, className: "bg-slate-500/15 text-slate-300 ring-slate-400/30", date: fmtDate(createdAt) };
  }
  return { label: "Relanzado en la app", className: "bg-violet-500/15 text-violet-300 ring-violet-400/30", date: fmtTime(createdAt) };
}

export type Tone = "ok" | "bad" | "muted";
export interface Cell {
  tone: Tone;
  title: string;
  detail: string;
}

/** Texto de la celda de una prueba (siempre con texto, nunca solo color). */
export function describeCell(test: EvalTest, r: EvalResultDTO | undefined): Cell {
  if (!r || r.status === "not_measured") return { tone: "muted", title: "No medido", detail: r?.metrics?.note ?? "" };
  if (r.status === "pending") return { tone: "muted", title: "Pendiente", detail: "" };
  const m: EvalMetrics = r.metrics ?? {};
  if (r.error) return { tone: "bad", title: "Error", detail: r.error };
  const t = fmtMs(m.latencyMs, m.latencyApprox);
  if (test === "orchestrator") {
    const detail = [m.tasks ? `${m.tasks} tareas` : null, m.latencyMs != null ? t : null].filter(Boolean).join(" · ");
    if (r.ok) return { tone: "ok", title: "JSON válido y sensato", detail };
    return { tone: "bad", title: m.jsonValid ? "JSON poco sensato" : "JSON no válido", detail };
  }
  if (test === "develop") {
    const checks = m.checksTotal != null ? `${m.checksPassed}/${m.checksTotal} checks` : "checks no medidos";
    const detail = [checks, m.latencyMs != null ? t : null].filter(Boolean).join(" · ");
    return { tone: m.compiles ? "ok" : "bad", title: m.compiles ? "Compila" : "No compila", detail };
  }
  const n = (m.bug1 ? 1 : 0) + (m.bug2 ? 1 : 0);
  return { tone: r.ok ? "ok" : "bad", title: `Detecta ${n}/2 fallos`, detail: m.latencyMs != null ? t : "" };
}

/** Latencia media: la que da el informe manual si existe; si no, la media de las medidas sin error. */
export function avgLatency(row: ModelRowDTO): { ms: number | null; approx: boolean } {
  const rs = Object.values(row.results);
  const reported = rs.map((r) => r?.metrics?.reportedAvgMs).find((v) => v != null);
  if (reported != null) return { ms: reported, approx: true };
  const vals = rs.filter((r) => r && !r.error).map((r) => r!.metrics?.latencyMs).filter((v): v is number => v != null);
  if (vals.length === 0) return { ms: null, approx: false };
  return { ms: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), approx: false };
}
