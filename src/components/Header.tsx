"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { CreateRunResponse, RunDTO } from "@/lib/types";
import { RUN_STATUS_LABEL, formatDateTime } from "./meta";

interface Props {
  runs: RunDTO[];
  currentId: number | null;
  onSelect: (id: number | null) => void;
  onCreated: (id: number) => void;
}

export function Header({ runs, currentId, onSelect, onCreated }: Props) {
  const selectId = useId();
  const textId = useId();
  const demoId = useId();
  const [demo, setDemo] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = runs.find((r) => r.id === currentId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const request = text.trim();
    if (!request || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, forceInitialFailure: demo }),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<CreateRunResponse> & { error?: string })
        | null;
      if (!res.ok || !data?.run) throw new Error(data?.error ?? "No se pudo crear la petición.");
      setText("");
      onCreated(data.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSending(false);
    }
  }

  return (
    <header className="border-b border-white/10 bg-slate-900/60 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <h1 className="bg-gradient-to-r from-violet-300 via-blue-300 to-emerald-300 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
              Equipo de agentes
            </h1>
            <p className="mt-1 text-sm text-slate-400">Orquestador, Develop y Testing trabajando en equipo</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href="/evals"
                className="rounded text-xs text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Evaluación de modelos
              </Link>
              <form method="post" action="/api/auth/logout">
                <button
                  type="submit"
                  className="rounded text-xs text-slate-400 underline-offset-2 transition hover:text-slate-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  Cerrar sesión
                </button>
              </form>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Ejecución actual
            </label>
            <div className="flex items-center gap-2">
              <select
                id={selectId}
                value={currentId ?? ""}
                disabled={runs.length === 0}
                onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}
                className="w-full min-w-0 max-w-xs rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 sm:w-72"
              >
                {runs.length === 0 && <option value="">Sin ejecuciones</option>}
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.id} · {r.request.length > 40 ? `${r.request.slice(0, 40)}…` : r.request}
                  </option>
                ))}
              </select>
              {current && (
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${RUN_STATUS_LABEL[current.status].badge}`}
                  title={`Creada ${formatDateTime(current.createdAt)}`}
                >
                  {RUN_STATUS_LABEL[current.status].label}
                </span>
              )}
              {current?.demo && (
                <span
                  className="shrink-0 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-200 ring-1 ring-inset ring-amber-400/30"
                  title="Run con fallo inicial forzado a propósito"
                >
                  Demo
                </span>
              )}
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="flex w-full flex-col gap-1 lg:max-w-xl">
          <label htmlFor={textId} className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Nueva petición
          </label>
          <div className="flex gap-2">
            <input
              id={textId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
              placeholder="Ej.: Añade una página de contacto · Crea una tabla de precios · Crea una FAQ"
              aria-describedby={error ? `${textId}-err` : undefined}
              aria-invalid={error ? true : undefined}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <input
              id={demoId}
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
              aria-describedby={`${demoId}-desc`}
              className="mt-0.5 size-4 shrink-0 rounded border-white/20 bg-slate-800 accent-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            />
            <div className="flex flex-col">
              <label htmlFor={demoId} className="text-sm text-slate-200">
                Demo: forzar un fallo inicial para ver el bucle de corrección
              </label>
              <p id={`${demoId}-desc`} className="text-xs text-slate-400">
                Develop entregará a propósito una versión con un defecto para que Testing lo detecte y se vea cómo se corrige.
              </p>
            </div>
          </div>
          {error && (
            <p id={`${textId}-err`} role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
        </form>
      </div>
    </header>
  );
}
