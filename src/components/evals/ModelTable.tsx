import { EVAL_TESTS, TEST_LABEL } from "@/lib/evals/models";
import type { ModelRowDTO } from "@/lib/evals/types";
import { avgLatency, describeCell, fmtMs, originBadge, type Tone } from "./format";

const TONE: Record<Tone, string> = { ok: "text-emerald-300", bad: "text-rose-300", muted: "text-slate-400" };
const TONE_MARK: Record<Tone, string> = { ok: "✓", bad: "✕", muted: "–" };

export function ModelTable({ models }: { models: ModelRowDTO[] }) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60"
      role="region"
      aria-label="Tabla comparativa de modelos"
      tabIndex={0}
    >
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <caption className="sr-only">Último resultado de cada modelo en las tres pruebas</caption>
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
            <th scope="col" className="px-4 py-3 font-medium">Modelo</th>
            {EVAL_TESTS.map((t) => (
              <th key={t} scope="col" className="px-4 py-3 font-medium">{TEST_LABEL[t]}</th>
            ))}
            <th scope="col" className="px-4 py-3 font-medium">Latencia media</th>
            <th scope="col" className="px-4 py-3 font-medium">Origen</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const avg = avgLatency(m);
            const badge = m.run ? originBadge(m.run.origin, m.run.createdAt) : null;
            return (
              <tr key={m.id} className="border-b border-white/5 align-top last:border-0">
                <th scope="row" className="px-4 py-3 font-medium text-slate-100">
                  <span className="break-all">{m.label}</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-400">
                    {m.provider === "nvidia" ? "NVIDIA" : "Google"}
                    {m.finalist && (
                      <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                        Finalista
                      </span>
                    )}
                  </span>
                </th>
                {EVAL_TESTS.map((t) => {
                  const c = describeCell(t, m.results[t]);
                  return (
                    <td key={t} className="px-4 py-3">
                      <span className={`font-medium ${TONE[c.tone]}`}>
                        <span aria-hidden="true">{TONE_MARK[c.tone]} </span>
                        {c.title}
                      </span>
                      {c.detail && <span className="mt-0.5 block text-xs text-slate-400">{c.detail}</span>}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-slate-200">{avg.ms != null ? fmtMs(avg.ms, avg.approx) : "No medido"}</td>
                <td className="px-4 py-3">
                  {badge ? (
                    <>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">{badge.date}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">Sin datos</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
