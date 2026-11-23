"use client";

import { useEffect, useRef, useState } from "react";
import type {
  EventDTO,
  FileDTO,
  RunDetailResponse,
  RunDTO,
  RunListResponse,
  TaskDTO,
} from "@/lib/types";

const POLL_MS = 1500;

interface State {
  runs: RunDTO[];
  runId: number | null;
  run: RunDTO | null;
  tasks: TaskDTO[];
  files: FileDTO[];
  events: EventDTO[];
  loading: boolean;
  error: string | null;
}

const INITIAL: State = {
  runs: [],
  runId: null,
  run: null,
  tasks: [],
  files: [],
  events: [],
  loading: true,
  error: null,
};

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Consulta cada 1,5 s la lista de runs y el detalle del run elegido.
 * Si `selectedId` es null sigue siempre al run más reciente.
 * Solo pide eventos nuevos (?after=) y se pausa con la pestaña oculta.
 */
export function useRun(selectedId: number | null) {
  const [state, setState] = useState<State>(INITIAL);
  const [reloadKey, setReloadKey] = useState(0);
  const cursor = useRef<{ runId: number | null; lastEventId: number }>({
    runId: null,
    lastEventId: 0,
  });

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function tick() {
      controller = new AbortController();
      try {
        const { runs } = await getJson<RunListResponse>("/api/runs", controller.signal);
        const runId = selectedId ?? runs[0]?.id ?? null;
        if (stopped) return;

        if (runId === null) {
          setState((s) => ({ ...s, runs, runId: null, run: null, loading: false, error: null }));
        } else {
          if (cursor.current.runId !== runId) cursor.current = { runId, lastEventId: 0 };
          const after = cursor.current.lastEventId;
          const detail = await getJson<RunDetailResponse>(
            `/api/runs/${runId}${after > 0 ? `?after=${after}` : ""}`,
            controller.signal,
          );
          if (stopped) return;
          const last = detail.events[detail.events.length - 1];
          if (last) cursor.current.lastEventId = last.id;
          setState((s) => {
            const sameRun = s.runId === runId;
            const known = new Set((sameRun ? s.events : []).map((e) => e.id));
            const fresh = detail.events.filter((e) => !known.has(e.id));
            return {
              runs,
              runId,
              run: detail.run,
              tasks: detail.tasks,
              files: detail.files,
              events: sameRun ? [...s.events, ...fresh] : fresh,
              loading: false,
              error: null,
            };
          });
        }
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : "Error de conexión",
        }));
      }
      if (!stopped && !document.hidden) timer = setTimeout(tick, POLL_MS);
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimeout(timer);
        controller?.abort();
      } else {
        clearTimeout(timer);
        void tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [selectedId, reloadKey]);

  return { ...state, refresh: () => setReloadKey((k) => k + 1) };
}
