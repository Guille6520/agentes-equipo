"use client";

import { Fragment, useState } from "react";
import type { FileDTO, TaskDTO } from "@/lib/types";
import { PreviewPane } from "./PreviewPane";

const KEYWORDS =
  "import|export|from|const|let|var|function|return|if|else|for|while|new|class|extends|async|await|default|type|interface|true|false|null|undefined|use client";

// Orden: comentario, cadena, etiqueta HTML/JSX, palabra clave, número.
const TOKEN = new RegExp(
  `(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(<\\/?[A-Za-z][\\w.-]*)|\\b(${KEYWORDS})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`,
  "g",
);

const CLASSES = [
  "",
  "text-slate-500 italic",
  "text-amber-300",
  "text-sky-300",
  "text-violet-300",
  "text-emerald-300",
];

/** Coloreado muy simple por expresiones regulares (sin dependencias). */
function highlight(code: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={i++}>{code.slice(last, idx)}</Fragment>);
    const group = m.findIndex((g, n) => n > 0 && g !== undefined);
    out.push(
      <span key={i++} className={CLASSES[group]}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < code.length) out.push(<Fragment key={i++}>{code.slice(last)}</Fragment>);
  return out;
}

type View = "preview" | "code";
const VIEWS: [View, string][] = [
  ["preview", "Vista previa"],
  ["code", "Código"],
];

interface Props {
  task: TaskDTO | null;
  files: FileDTO[];
}

export function FileViewer({ task, files }: Props) {
  const [chosen, setChosen] = useState<{ taskId: number; path: string } | null>(null);

  const taskFiles = task ? files.filter((f) => f.taskId === task.id) : [];
  // Última versión de cada ruta (los archivos llegan ordenados por versión).
  const latest = new Map<string, FileDTO>();
  for (const f of taskFiles) latest.set(f.path, f);
  const paths = [...latest.keys()];
  const activePath = chosen && task && chosen.taskId === task.id && latest.has(chosen.path) ? chosen.path : paths[0];
  const file = activePath ? latest.get(activePath) : undefined;
  const version = Math.max(0, ...[...latest.values()].map((f) => f.version));
  const hasFiles = Boolean(task) && paths.length > 0;

  // Pestañas Vista previa / Código (flechas izquierda/derecha para cambiar, patrón ARIA de tabs).
  const [view, setView] = useState<View>("preview");
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: View = view === "preview" ? "code" : "preview";
    setView(next);
    document.getElementById(`files-tab-${next}`)?.focus();
  };

  return (
    <section aria-labelledby="files-title" className="flex min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="files-title" className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Archivos generados{task ? ` · ${task.title}` : ""}
        </h2>
        {hasFiles && (
          <div role="tablist" aria-label="Modo de visualización" className="flex gap-1 rounded-lg bg-slate-900/70 p-1 ring-1 ring-white/10">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                id={`files-tab-${id}`}
                role="tab"
                type="button"
                aria-selected={view === id}
                aria-controls={`files-panel-${id}`}
                tabIndex={view === id ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={onTabKey}
                className={`rounded-md px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  view === id ? "bg-violet-500/25 text-violet-100" : "text-slate-400 hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={`${hasFiles && view === "preview" ? "h-[36rem]" : "h-96"} overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50`}
      >
        {!task ? (
          <p className="p-10 text-center text-sm text-slate-500">Selecciona una tarea del tablero para ver sus archivos.</p>
        ) : paths.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">Esta tarea aún no ha generado archivos.</p>
        ) : view === "preview" ? (
          <div id="files-panel-preview" role="tabpanel" aria-labelledby="files-tab-preview" className="h-full">
            <PreviewPane runId={task.runId} taskId={task.id} version={version} taskStatus={task.status} />
          </div>
        ) : (
          <div id="files-panel-code" role="tabpanel" aria-labelledby="files-tab-code" className="flex h-full flex-col">
            <div role="tablist" aria-label="Archivos de la tarea" className="flex gap-1 overflow-x-auto border-b border-white/10 p-2">
              {paths.map((p) => (
                <button
                  key={p}
                  role="tab"
                  type="button"
                  aria-selected={p === activePath}
                  onClick={() => setChosen({ taskId: task.id, path: p })}
                  className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    p === activePath ? "bg-blue-500/20 text-blue-200" : "text-slate-400 hover:bg-white/5"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {file && (
              <>
                <p className="px-4 pt-2 text-xs text-slate-500">Versión {file.version}</p>
                <pre
                  tabIndex={0}
                  className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                >
                  <code>{highlight(file.content)}</code>
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
