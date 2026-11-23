import { FINALISTS, STEP_PLAN, TEST_LABEL } from "@/lib/evals/models";
import type { ActiveRunDTO, EvalResultDTO } from "@/lib/evals/types";
import { describeCell } from "./format";

interface Props {
  active: ActiveRunDTO | null;
  driving: boolean;
  cooldownLeft: number;
  message: { kind: "error" | "info"; text: string } | null;
  onLaunch: () => void;
}

function stepLabel(s: EvalResultDTO, current: boolean): { text: string; className: string } {
  if (s.status === "pending") {
    return current
      ? { text: "En curso…", className: "text-blue-300" }
      : { text: "Pendiente", className: "text-slate-400" };
  }
  const c = describeCell(s.test, s);
  const mark = c.tone === "ok" ? "✓" : "✕";
  return {
    text: `${mark} ${c.title}${c.detail ? ` · ${c.detail}` : ""}`,
    className: c.tone === "ok" ? "text-emerald-300" : "text-rose-300",
  };
}

export function RunPanel({ active, driving, cooldownLeft, message, onLaunch }: Props) {
  const running = driving || active != null;
  const disabled = running || cooldownLeft > 0;
  const firstPending = active?.steps.find((s) => s.status === "pending")?.id;
  const done = active?.steps.filter((s) => s.status !== "pending").length ?? 0;
  const total = active?.steps.length ?? STEP_PLAN.length;
  const mins = Math.floor(cooldownLeft / 60);
  const secs = String(cooldownLeft % 60).padStart(2, "0");

  return (
    <section aria-labelledby="relanzar" className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="relanzar" className="text-base font-semibold text-slate-100">Relanzar la evaluación</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-300">
            Vuelve a medir los {FINALISTS.length} finalistas ({FINALISTS.map((m, i) => (
              <span key={m.id}>
                {i > 0 && (i === FINALISTS.length - 1 ? " y " : ", ")}
                <span className="font-medium">{m.label}</span>
              </span>
            ))}) con las tres pruebas, llamando a los modelos reales. Son {STEP_PLAN.length} llamadas, una por paso, sin
            respaldo entre proveedores. Máximo una evaluación nueva cada 10 minutos.
          </p>
        </div>
        <button
          type="button"
          onClick={onLaunch}
          disabled={disabled}
          className="shrink-0 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Evaluación en curso…" : `Relanzar evaluación (${FINALISTS.length} modelos)`}
        </button>
      </div>

      {!running && cooldownLeft > 0 && (
        <p className="mt-3 text-sm text-amber-200">
          Podrás relanzarla de nuevo en {mins}:{secs} min (límite de uso para respetar la cuota gratuita).
        </p>
      )}

      <div role="status" aria-live="polite" className="mt-3 min-h-5 text-sm">
        {message && <p className={message.kind === "error" ? "text-rose-300" : "text-slate-300"}>{message.text}</p>}
      </div>

      {active && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Progreso: {done} de {total} pasos</span>
            <span>Evaluación #{active.run.id}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Progreso de la evaluación"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400 transition-all"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </div>
          <ol className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10 text-sm">
            {active.steps.map((s) => {
              const l = stepLabel(s, s.id === firstPending);
              return (
                <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-slate-200">
                    {s.step + 1}. <span className="font-medium">{s.model}</span> · {TEST_LABEL[s.test]}
                  </span>
                  <span className={`text-xs sm:text-sm ${l.className}`}>{l.text}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
