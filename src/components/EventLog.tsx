"use client";

import { useEffect, useRef } from "react";
import type { EventDTO } from "@/lib/types";
import { AGENTS, formatTime } from "./meta";

export function EventLog({ events }: { events: EventDTO[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section aria-labelledby="log-title" className="flex min-h-0 flex-col">
      <h2 id="log-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Registro de actividad
      </h2>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        role="log"
        aria-live="polite"
        tabIndex={0}
        className="h-96 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/50 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        {events.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Todavía no hay eventos.</p>
        ) : (
          <ol className="relative ml-2 border-l border-white/10">
            {events.map((e) => {
              const a = AGENTS[e.agent];
              return (
                <li key={e.id} className="relative mb-4 pl-5 last:mb-0 animate-[card-in_0.4s_ease-out]">
                  <span
                    className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-slate-900 ${a.dot}`}
                    aria-hidden="true"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${a.badge}`}>
                      {a.label}
                    </span>
                    <time dateTime={e.createdAt} className="font-mono text-xs text-slate-500">
                      {formatTime(e.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{e.message}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
