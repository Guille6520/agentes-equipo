import { EVAL_TESTS, TEST_LABEL, type EvalTest } from "@/lib/evals/models";
import type { ModelRowDTO } from "@/lib/evals/types";
import { fmtMs } from "./format";

const BAR: Record<EvalTest, string> = { orchestrator: "bg-violet-400", develop: "bg-blue-400", testing: "bg-emerald-400" };

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function LatencyChart({ models }: { models: ModelRowDTO[] }) {
  const rows = models
    .map((m) => ({
      m,
      items: EVAL_TESTS.map((t) => ({ t, ms: m.results[t]?.error ? null : (m.results[t]?.metrics?.latencyMs ?? null) })).filter(
        (x): x is { t: EvalTest; ms: number } => x.ms != null,
      ),
    }))
    .filter((r) => r.items.length > 0);
  const max = Math.max(1, ...rows.flatMap((r) => r.items.map((i) => i.ms)));

  return (
    <Card title="Latencia por prueba" note="Escala lineal, común a todos los modelos. Las pruebas con error o no medidas no aparecen.">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300" aria-label="Leyenda">
        {EVAL_TESTS.map((t) => (
          <li key={t} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${BAR[t]}`} />
            {TEST_LABEL[t]}
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-slate-400">Sin latencias medidas.</p>}
      {rows.map(({ m, items }) => (
        <div key={m.id}>
          <p className="break-all text-xs font-medium text-slate-200">{m.label}</p>
          <ul className="mt-1.5 space-y-1">
            {items.map((i) => (
              <li key={i.t} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-slate-400">{TEST_LABEL[i.t]}</span>
                <span aria-hidden="true" className="h-2.5 flex-1 rounded-full bg-slate-800">
                  <span className={`block h-full rounded-full ${BAR[i.t]}`} style={{ width: `${Math.max(1.5, (i.ms / max) * 100)}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-200">{fmtMs(i.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

export function ChecksChart({ models }: { models: ModelRowDTO[] }) {
  const rows = models
    .map((m) => ({ m, r: m.results.develop }))
    .filter((x) => x.r && !x.r.error && x.r.metrics?.checksTotal);
  return (
    <Card
      title="Develop: checks superados"
      note="Checks superados / total. El benchmark manual contaba 9 checks con expresiones regulares; el relanzamiento usa los checks deterministas del motor de Testing: los totales no son comparables uno a uno."
    >
      {rows.length === 0 && <p className="text-sm text-slate-400">Sin resultados de Develop.</p>}
      {rows.map(({ m, r }) => {
        const pass = r!.metrics!.checksPassed ?? 0;
        const total = r!.metrics!.checksTotal ?? 1;
        const pct = Math.round((pass / total) * 100);
        return (
          <div key={m.id}>
            <p className="break-all text-xs font-medium text-slate-200">{m.label}</p>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span aria-hidden="true" className="h-2.5 flex-1 rounded-full bg-slate-800">
                <span className="block h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-400" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-28 shrink-0 text-right tabular-nums text-slate-200">
                {pass}/{total} ({pct} %)
              </span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
