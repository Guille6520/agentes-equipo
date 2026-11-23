// Check 6: criterios de aceptación del Orquestador, comprobados sobre el HTML del render en sandbox
// (el mismo render de check-render.ts, no se renderiza dos veces). Si no hay HTML (render omitido
// por seguridad/sintaxis o el componente lanza), los criterios quedan "omitidos", nunca aprobados.
import type { AcceptanceCriterion, AcceptanceStatus } from "@/lib/types";
import { describeCriterion, selectorLabel } from "./acceptance-describe";
import type { CheckResult } from "./types";

const NAME = "Criterios del Orquestador";

export type AcceptanceOutcome = { criterion: AcceptanceCriterion; status: AcceptanceStatus; message: string };

/** Minúsculas, sin tildes y con espacios colapsados: «Envíar  Mensaje» ~ «enviar mensaje». */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Texto visible de un fragmento HTML (sin etiquetas, script ni style). */
const textOf = (html: string) =>
  norm(decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")));

type Tag = { name: string; attrs: Map<string, string> };

function openingTags(html: string): Tag[] {
  const out: Tag[] = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const a of m[2].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
    }
    out.push({ name: m[1].toLowerCase(), attrs });
  }
  return out;
}

/** Contenido de cada <tag>...</tag> (válido para etiquetas que no se anidan: h1-h6, a). */
const innerOf = (html: string, tags: string[]) =>
  [...html.matchAll(new RegExp(`<(${tags.join("|")})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi"))].map((m) => ({
    tag: m[1].toLowerCase(),
    text: textOf(m[2]),
  }));

function matchesSelector(tag: Tag, selector: string): boolean {
  const m = /^([a-z][a-z0-9]*)(?:\[type=([a-z-]+)\])?$/.exec(selector);
  if (!m || tag.name !== m[1]) return false;
  if (!m[2]) return true;
  // Un <button> sin type es "submit" en HTML.
  const type = (tag.attrs.get("type") ?? (tag.name === "button" ? "submit" : "text")).toLowerCase();
  return type === m[2];
}

function evaluate(c: AcceptanceCriterion, html: string, tags: Tag[]): { ok: boolean; message: string } {
  const desc = describeCriterion(c);
  switch (c.type) {
    case "text": {
      // Texto visible + el value de los botones <input type="submit|button">.
      const buttons = tags
        .filter((t) => t.name === "input" && /^(submit|button|reset)$/i.test(t.attrs.get("type") ?? ""))
        .map((t) => t.attrs.get("value") ?? "");
      const visible = `${textOf(html)} ${norm(buttons.join(" "))}`;
      return visible.includes(norm(c.value))
        ? { ok: true, message: `Aparece el texto visible «${c.value}».` }
        : { ok: false, message: `Falta el texto visible «${c.value}» pedido por el Orquestador.` };
    }
    case "element": {
      const min = c.min ?? 1;
      const count = tags.filter((t) => matchesSelector(t, c.selector)).length;
      const label = selectorLabel(c.selector);
      if (count >= min) return { ok: true, message: `Hay ${count} ${label} (se piden ${min}).` };
      return {
        ok: false,
        message:
          count === 0
            ? `Falta el elemento ${label} pedido por el Orquestador${min > 1 ? ` (al menos ${min})` : ""}.`
            : `El HTML renderizado tiene ${count} ${label} y el Orquestador pide al menos ${min}.`,
      };
    }
    case "field": {
      const want = c.name.toLowerCase();
      const fields = tags.filter(
        (t) =>
          ["input", "textarea", "select"].includes(t.name) &&
          (t.attrs.get("name")?.toLowerCase() === want || t.attrs.get("id")?.toLowerCase() === want),
      );
      if (fields.length === 0) {
        return {
          ok: false,
          message: `Falta el campo «${c.name}» (input/textarea/select con name="${c.name}") pedido por el Orquestador.`,
        };
      }
      if (c.required && !fields.some((t) => t.attrs.has("required") || t.attrs.get("aria-required") === "true")) {
        return {
          ok: false,
          message: `El campo «${c.name}» existe pero no es obligatorio: añade el atributo required, como pide el Orquestador.`,
        };
      }
      return { ok: true, message: `Cumple: ${desc}.` };
    }
    case "heading": {
      const levels = c.level ? [`h${c.level}`] : ["h1", "h2", "h3", "h4", "h5", "h6"];
      const found = innerOf(html, levels).some((h) => h.text.includes(norm(c.text)));
      return found
        ? { ok: true, message: `Cumple: ${desc}.` }
        : {
            ok: false,
            message: `Falta un encabezado ${c.level ? `<h${c.level}>` : "(h1-h6)"} con el texto «${c.text}» pedido por el Orquestador.`,
          };
    }
    case "link": {
      const found = innerOf(html, ["a"]).some((a) => a.text.includes(norm(c.text)));
      return found
        ? { ok: true, message: `Cumple: ${desc}.` }
        : { ok: false, message: `Falta un enlace <a> con el texto «${c.text}» pedido por el Orquestador.` };
    }
  }
}

/**
 * Comprueba los criterios contra el HTML. `html === null` significa que no hubo render (omitido o
 * fallido): cada criterio queda "skipped" y no genera resultado aprobado. `skipReason` explica por qué.
 */
export function checkAcceptance(
  criteria: AcceptanceCriterion[],
  html: string | null,
  { entry, skipReason = "no hay HTML renderizado" }: { entry?: string; skipReason?: string } = {},
): { results: CheckResult[]; outcomes: AcceptanceOutcome[] } {
  if (criteria.length === 0) return { results: [], outcomes: [] };
  if (html === null) {
    const outcomes = criteria.map((criterion) => ({
      criterion,
      status: "skipped" as const,
      message: `Omitido: ${skipReason}.`,
    }));
    return { results: [], outcomes };
  }
  const tags = openingTags(html);
  const outcomes: AcceptanceOutcome[] = [];
  const results: CheckResult[] = [];
  for (const criterion of criteria) {
    const { ok, message } = evaluate(criterion, html, tags);
    outcomes.push({ criterion, status: ok ? "passed" : "failed", message });
    results.push({ id: `acceptance-${criterion.type}`, name: NAME, passed: ok, severity: "error", message, file: entry });
  }
  return { results, outcomes };
}
