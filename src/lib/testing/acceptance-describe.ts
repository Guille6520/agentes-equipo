// Texto en español de los criterios de aceptación. Sin dependencias (ni zod ni node): lo usan el
// motor, Testing y la UI (tablero), así que debe poder ir en el bundle del cliente.
import type { AcceptanceCriterion } from "@/lib/types";

/** `input[type=email]` -> `<input type="email">`; `form` -> `<form>`. */
export function selectorLabel(selector: string): string {
  const m = /^([a-z][a-z0-9]*)(?:\[type=([a-z-]+)\])?$/.exec(selector);
  if (!m) return selector;
  return m[2] ? `<${m[1]} type="${m[2]}">` : `<${m[1]}>`;
}

/** Descripción corta: «texto «Enviar»», «campo email obligatorio», «al menos 3 <li>». */
export function describeCriterion(c: AcceptanceCriterion): string {
  switch (c.type) {
    case "text":
      return `texto «${c.value}»`;
    case "element":
      return c.min && c.min > 1 ? `al menos ${c.min} ${selectorLabel(c.selector)}` : `elemento ${selectorLabel(c.selector)}`;
    case "field":
      return `campo ${c.name}${c.required ? " obligatorio" : ""}`;
    case "heading":
      return `encabezado${c.level ? ` h${c.level}` : ""} «${c.text}»`;
    case "link":
      return `enlace «${c.text}»`;
  }
}
