// Vocabulario cerrado de criterios de aceptación que el Orquestador asigna a cada tarea y Testing
// comprueba de forma determinista sobre el HTML del render en sandbox (estado inicial del componente).
//
//   {type:"text",    value:"Enviar"}                    texto visible (contiene, sin distinguir mayúsculas/tildes)
//   {type:"element", selector:"li", min:3}              al menos `min` (1 por defecto) elementos que casan con el selector
//   {type:"field",   name:"email", required:true}       input/textarea/select con name o id = "email" (y `required` si se pide)
//   {type:"heading", text:"Contacto", level:1}          h1-h6 (o solo el nivel indicado) cuyo texto contiene «Contacto»
//   {type:"link",    text:"Inicio"}                     <a> cuyo texto contiene «Inicio»
//
// Selectores admitidos: una etiqueta de ELEMENT_TAGS, o input/button con [type=...] de INPUT_TYPES.
// Los criterios inválidos se descartan uno a uno (nunca tumban el plan).
import { z } from "zod";
import type { AcceptanceCriterion } from "@/lib/types";

export const MAX_CRITERIA = 5;

export const ELEMENT_TAGS = [
  "form", "button", "input", "textarea", "select", "label", "a", "img",
  "h1", "h2", "h3", "h4", "h5", "h6", "p",
  "nav", "header", "footer", "main", "section", "article", "aside",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
  "fieldset", "legend", "details", "summary", "figure", "dl", "dt", "dd",
] as const;
export const INPUT_TYPES = [
  "text", "email", "tel", "password", "number", "checkbox", "radio", "search", "url", "date", "submit", "button", "reset",
] as const;

/** Normaliza `input[type="email"]`, `INPUT[ type='email' ]`... a `input[type=email]`. */
export function normalizeSelector(raw: string): string {
  return raw.toLowerCase().replace(/["'\s]/g, "");
}

export function isValidSelector(selector: string): boolean {
  const m = /^([a-z][a-z0-9]*)(?:\[type=([a-z-]+)\])?$/.exec(selector);
  if (!m || !(ELEMENT_TAGS as readonly string[]).includes(m[1])) return false;
  if (!m[2]) return true;
  return (m[1] === "input" || m[1] === "button") && (INPUT_TYPES as readonly string[]).includes(m[2]);
}

const shortText = z.string().trim().min(1).max(80);

export const criterionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: shortText }),
  z.object({
    type: z.literal("element"),
    selector: z.string().transform(normalizeSelector).refine(isValidSelector, "selector no admitido"),
    min: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    type: z.literal("field"),
    name: z.string().trim().regex(/^[A-Za-z][\w-]{0,39}$/, "nombre de campo no válido"),
    required: z.boolean().optional(),
  }),
  z.object({ type: z.literal("heading"), text: shortText, level: z.number().int().min(1).max(6).optional() }),
  z.object({ type: z.literal("link"), text: shortText }),
]);

/**
 * Valida una lista que viene del modelo (o de la BD): descarta los criterios inválidos o repetidos
 * sin lanzar y se queda con los MAX_CRITERIA primeros. Devuelve también cuántos se descartaron.
 */
export function parseAcceptance(raw: unknown): { criteria: AcceptanceCriterion[]; discarded: number } {
  if (!Array.isArray(raw)) return { criteria: [], discarded: raw == null ? 0 : 1 };
  const seen = new Set<string>();
  const criteria: AcceptanceCriterion[] = [];
  let discarded = 0;
  for (const item of raw) {
    const r = criterionSchema.safeParse(item);
    if (!r.success) { discarded++; continue; }
    const c = r.data as AcceptanceCriterion;
    const key = JSON.stringify(c).toLowerCase();
    if (seen.has(key)) { discarded++; continue; }
    seen.add(key);
    criteria.push(c);
  }
  discarded += Math.max(0, criteria.length - MAX_CRITERIA);
  return { criteria: criteria.slice(0, MAX_CRITERIA), discarded };
}
