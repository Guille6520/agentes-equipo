"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { STEP_PLAN } from "@/lib/evals/models";
import type { EvalsOverview, StepResponse } from "@/lib/evals/types";
import { ChecksChart, LatencyChart } from "./Charts";
import { ModelTable } from "./ModelTable";
import { RunPanel } from "./RunPanel";

const PAUSE_MS = 2000;
const BUSY_WAIT_MS = 4000;
const MAX_BUSY_WAITS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

export function EvalsDashboard() {
  const [overview, setOverview] = useState<EvalsOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [now, setNow] = useState(0);
  const drivingRef = useRef(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api<EvalsOverview>("/api/evals");
      if (!aliveRef.current) return null;
      if (!r.ok) throw new Error(r.data.error ?? `HTTP ${r.status}`);
      setOverview(r.data);
      setLoadError(null);
      const t = Date.now();
      setNow(t);
      setCooldownEnd(t + r.data.cooldownSeconds * 1000);
      return r.data;
    } catch (e) {
      if (aliveRef.current) setLoadError(e instanceof Error ? e.message : "Error inesperado.");
      return null;
    }
  }, []);

  /** Recorre los pasos pendientes de una evaluación, uno por llamada, con pausa entre pasos. */
  const drive = useCallback(
    async (runId: number) => {
      if (drivingRef.current) return;
      drivingRef.current = true;
      setDriving(true);
      let busyWaits = 0;
      try {
        while (aliveRef.current) {
          const r = await api<StepResponse>(`/api/evals/${runId}/step`, { method: "POST" });
          if (!r.ok) {
            setMessage({ kind: "error", text: r.data.error ?? `El paso falló (HTTP ${r.status}).` });
            break;
          }
          await refresh();
          if (r.data.state === "finished") {
            setMessage({ kind: "info", text: "Evaluación terminada. La tabla muestra los nuevos resultados." });
            break;
          }
          if (r.data.state === "busy") {
            if (++busyWaits > MAX_BUSY_WAITS) {
              setMessage({ kind: "error", text: "Otro paso sigue en curso desde hace demasiado tiempo. Recarga la página en un minuto." });
              break;
            }
            await sleep(BUSY_WAIT_MS);
          } else {
            busyWaits = 0;
            await sleep(PAUSE_MS);
          }
        }
      } catch {
        setMessage({ kind: "error", text: "Se perdió la conexión durante la evaluación. Recarga la página para continuar." });
      } finally {
        drivingRef.current = false;
        if (aliveRef.current) setDriving(false);
        await refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      const o = await refresh();
      // Si había una evaluación a medias (p. ej. se recargó la página), se retoma.
      if (o?.active) {
        setMessage({ kind: "info", text: "Retomando la evaluación en curso…" });
        void drive(o.active.run.id);
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh, drive]);

  useEffect(() => {
    if (cooldownEnd <= now) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownEnd, now]);

  async function launch() {
    if (drivingRef.current) return;
    setMessage({ kind: "info", text: "Creando la evaluación…" });
    try {
      const r = await api<{ run?: { id: number }; runId?: number }>("/api/evals", { method: "POST" });
      if (r.status === 201 && r.data.run) {
        await refresh();
        setMessage({ kind: "info", text: `Ejecutando los ${STEP_PLAN.length} pasos (una llamada a un modelo por paso)…` });
        void drive(r.data.run.id);
      } else if (r.status === 409 && r.data.runId) {
        setMessage({ kind: "info", text: "Ya había una evaluación en curso; se retoma." });
        await refresh();
        void drive(r.data.runId);
      } else {
        setMessage({ kind: "error", text: r.data.error ?? "No se pudo crear la evaluación." });
        await refresh();
      }
    } catch {
      setMessage({ kind: "error", text: "No se pudo contactar con el servidor." });
    }
  }

  const cooldownLeft = Math.max(0, Math.ceil((cooldownEnd - now) / 1000));

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-white/10 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 py-5 sm:px-6">
          <Link
            href="/"
            className="w-fit rounded text-sm text-slate-300 underline-offset-2 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            ← Volver al tablero
          </Link>
          <h1 className="bg-gradient-to-r from-violet-300 via-blue-300 to-emerald-300 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
            Evaluación de modelos
          </h1>
          <p className="text-sm text-slate-400">Qué modelo usa cada agente y por qué, con datos.</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-6 px-4 py-6 sm:px-6">
        <section aria-labelledby="metodologia" className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5">
          <h2 id="metodologia" className="text-base font-semibold text-slate-100">Metodología y limitaciones</h2>
          <p className="mt-2 max-w-4xl text-sm text-slate-300">
            Cada modelo recibe tres pruebas: el <span className="text-violet-300">Orquestador</span> divide «Añade una página de
            contacto a esta web» en 3-5 tareas en JSON; <span className="text-blue-300">Develop</span> genera un componente de
            contacto que se compila y pasa por los checks deterministas; <span className="text-emerald-300">Testing</span> debe
            detectar los dos fallos plantados en un código. Los resultados «Manual 23/11» son del benchmark del 23/11/2026
            (script <code className="rounded bg-slate-800 px-1">scripts/model-bench.mjs</code>), y los «Manual Groq 23/11»
            del benchmark de los candidatos de Groq (<code className="rounded bg-slate-800 px-1">scripts/bench-groq.ts</code>,
            dos ejecuciones por prueba); los «Relanzado en la app» salen de ejecutar de nuevo los tres finalistas desde esta
            página.
          </p>
          <p className="mt-2 max-w-4xl text-sm text-amber-200/90">
            Limitaciones: muestras mínimas (una o dos ejecuciones por prueba y un solo prompt por agente), detección de fallos y
            «sensato» con heurísticas, no con revisión humana, y «compila» solo significa que pasa el chequeo de tipos. «No
            medido» indica que el informe manual no obtuvo dato, no que el modelo fallase. Detalle completo en{" "}
            <code className="rounded bg-slate-800 px-1">docs/model-comparison.md</code> y{" "}
            <code className="rounded bg-slate-800 px-1">docs/seleccion-de-modelos.md</code> del repositorio.
          </p>
        </section>

        <RunPanel
          active={overview?.active ?? null}
          driving={driving}
          cooldownLeft={cooldownLeft}
          message={message}
          onLaunch={launch}
        />

        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            <span>No se pudieron cargar los datos: {loadError}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md bg-rose-500/20 px-3 py-1 font-medium hover:bg-rose-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Reintentar
            </button>
          </div>
        )}

        {!overview && !loadError ? (
          <div role="status" aria-live="polite" className="space-y-4">
            <span className="sr-only">Cargando resultados…</span>
            <div className="h-72 animate-pulse rounded-2xl bg-slate-900/70" />
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-64 animate-pulse rounded-2xl bg-slate-900/70" />
              <div className="h-64 animate-pulse rounded-2xl bg-slate-900/70" />
            </div>
          </div>
        ) : overview && overview.models.every((m) => m.run === null) ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
            <p className="text-lg font-medium text-slate-200">Aún no hay resultados</p>
            <p className="mt-1 text-sm text-slate-400">
              Carga el histórico con <code>npx tsx scripts/seed-evals.ts</code> o relanza la evaluación.
            </p>
          </div>
        ) : (
          overview && (
            <>
              <ModelTable models={overview.models} />
              <div className="grid gap-4 lg:grid-cols-2">
                <LatencyChart models={overview.models} />
                <ChecksChart models={overview.models} />
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
