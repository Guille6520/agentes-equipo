"use client";

import { useState } from "react";
import type { TaskStatus } from "@/lib/types";

interface Props {
  runId: number;
  taskId: number;
  /** Versión más reciente de los archivos de la tarea: al cambiar, el iframe se recarga. */
  version: number;
  taskStatus: TaskStatus;
}

/**
 * Vista previa en vivo del código generado, montado dentro de una "web de ejemplo".
 *
 * Seguridad: el iframe usa sandbox="allow-scripts allow-forms" SIN allow-same-origin, así que el
 * documento tiene un origen opaco: no ve las cookies de sesión ni el DOM de esta app, y la CSP de
 * /api/runs/[id]/preview le prohíbe cualquier conexión de red. A diferencia de node:vm (Testing),
 * esto sí es una frontera de seguridad del navegador. Lo que no evita: que el código muestre
 * contenido engañoso dentro del propio recuadro. Detalle completo en src/lib/preview/build.ts.
 */
export function PreviewPane({ runId, taskId, version, taskStatus }: Props) {
  const [reloads, setReloads] = useState(0);
  const src = `/api/runs/${runId}/preview?task=${taskId}&v=${version}`;
  const frameKey = `${src}#${reloads}`;
  // El estado de carga se guarda por clave: al cambiar de tarea/versión o recargar vuelve a "cargando".
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== frameKey;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <p className="text-xs text-slate-400">
          Versión {version}
          {taskStatus !== "passed" && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">sin aprobar por Testing</span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setReloads((n) => n + 1)}
            className="rounded-md px-2.5 py-1 text-xs text-slate-300 ring-1 ring-white/15 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Recargar
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-2.5 py-1 text-xs text-slate-300 ring-1 ring-white/15 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Abrir en pestaña nueva<span className="sr-only"> (vista previa)</span>
          </a>
        </div>
      </div>
      <div className="relative flex-1 bg-slate-950">
        {loading && (
          <div role="status" aria-live="polite" className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Cargando vista previa…
          </div>
        )}
        <iframe
          key={frameKey}
          src={src}
          title="Vista previa de la página generada por los agentes"
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedKey(frameKey)}
          className={`h-full w-full border-0 bg-white transition-opacity ${loading ? "opacity-0" : "opacity-100"}`}
        />
      </div>
    </div>
  );
}
