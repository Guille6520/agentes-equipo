// API pública del motor de agentes.
import { advanceRun, type AdvanceResult } from "./advance";

export { advanceRun, type AdvanceResult, type AdvanceOutcome } from "./advance";

/**
 * Avanza el run en bucle hasta que termine, otro proceso tenga el lease o se agote el presupuesto
 * de tiempo. Solo se empieza un paso nuevo si queda margen (un paso puede tardar hasta ~3 min en el
 * peor caso: 3 llamadas de 60 s). Si la función se corta igualmente, el lease caduca solo y la UI
 * retoma el run con POST /api/runs/[id]/advance.
 */
export async function advanceLoop(
  runId: number,
  { budgetMs, onStep }: { budgetMs: number; onStep?: (r: AdvanceResult, i: number) => void },
): Promise<AdvanceResult | null> {
  const t0 = Date.now();
  let last: AdvanceResult | null = null;
  for (let i = 0; Date.now() - t0 < budgetMs; i++) {
    last = await advanceRun(runId);
    onStep?.(last, i);
    if (!last.more || last.outcome === "busy") break;
    if (last.outcome === "error") await new Promise((r) => setTimeout(r, 3_000));
  }
  return last;
}
