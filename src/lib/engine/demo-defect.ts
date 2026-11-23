// Modo demo: inyecta de forma DETERMINISTA un defecto real en el código entregado por Develop para
// que los checks de Testing lo detecten y se vea el bucle Testing -> Develop. No se le pide nada al
// modelo: el código ya generado se post-procesa y cada candidato se verifica con el check real
// (checkA11y) antes de usarlo, de modo que el fallo es genuino y no inventado.
import ts from "typescript";
import { attrValue, collectJsx, getAttr, insideLabel, isJsxFile, parseFiles, tagName, type JsxEl } from "@/lib/testing/ast-utils";
import { checkA11y } from "@/lib/testing/check-a11y";
import type { GeneratedFile } from "@/lib/testing";

export interface DemoDefect {
  /** Archivos con el defecto aplicado (misma lista, mismo orden). */
  files: GeneratedFile[];
  /** Descripción corta del defecto, para el log. */
  description: string;
}

type Edit = { start: number; end: number; text: string };

const NO_LABEL_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

function applyEdits(content: string, edits: Edit[]): string {
  let out = content;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const removeAttr = (a: ts.JsxAttribute): Edit => ({ start: a.getFullStart(), end: a.getEnd(), text: "" });

/** ¿El contenido (ya modificado) provoca de verdad el fallo de a11y indicado? */
function failsA11y(file: GeneratedFile, id: string): boolean {
  const res = checkA11y([file]) as { id: string; passed: boolean }[];
  return res.some((r) => !r.passed && r.id === id);
}

function isField(el: JsxEl): boolean {
  const tag = tagName(el);
  if (!["input", "textarea", "select"].includes(tag)) return false;
  const type = getAttr(el, "type");
  return !(tag === "input" && type && NO_LABEL_INPUT_TYPES.has(attrValue(type).text));
}

/** Quita id / aria-label / aria-labelledby de un campo (y el htmlFor que apunta a él). */
function unlabelField(file: GeneratedFile): { content: string; description: string } | null {
  const [parsed] = parseFiles([file]);
  if (!parsed) return null;
  const els = collectJsx(parsed.sf);
  const candidates = els.filter((el) => isField(el) && !insideLabel(el));
  for (const field of candidates) {
    const edits: Edit[] = [];
    for (const name of ["id", "aria-label", "aria-labelledby"]) {
      const a = getAttr(field, name);
      if (a) edits.push(removeAttr(a));
    }
    const idAttr = getAttr(field, "id");
    if (idAttr) {
      const idText = attrValue(idAttr).text;
      for (const el of els) {
        if (tagName(el) !== "label") continue;
        const f = getAttr(el, "htmlFor");
        if (f && attrValue(f).text === idText) edits.push(removeAttr(f));
      }
    }
    if (edits.length === 0) continue;
    const content = applyEdits(file.content, edits);
    if (failsA11y({ path: file.path, content }, "a11y-label")) {
      return { content, description: `campo <${tagName(field)}> sin etiqueta` };
    }
  }
  return null;
}

/** Quita el alt de una <img> existente o, si no hay, añade una <img> sin alt. */
function breakImage(file: GeneratedFile): { content: string; description: string } | null {
  const [parsed] = parseFiles([file]);
  if (!parsed) return null;
  const els = collectJsx(parsed.sf);
  for (const img of els.filter((el) => tagName(el) === "img")) {
    const alt = getAttr(img, "alt");
    if (!alt) continue;
    const content = applyEdits(file.content, [removeAttr(alt)]);
    if (failsA11y({ path: file.path, content }, "a11y-img-alt")) return { content, description: "imagen sin atributo alt" };
  }
  // Sin imágenes: se inserta una <img> sin alt justo tras la apertura del primer elemento con hijos.
  let anchor: ts.JsxOpeningElement | undefined;
  const visit = (n: ts.Node) => {
    if (!anchor && ts.isJsxElement(n) && n.children.length > 0) anchor = n.openingElement;
    if (!anchor) ts.forEachChild(n, visit);
  };
  visit(parsed.sf);
  if (!anchor) return null;
  const content = applyEdits(file.content, [{ start: anchor.getEnd(), end: anchor.getEnd(), text: '<img src="/demo.png" />' }]);
  return failsA11y({ path: file.path, content }, "a11y-img-alt") ? { content, description: "imagen sin atributo alt" } : null;
}

/**
 * Intenta introducir un defecto en los archivos entregados. Prioriza un campo sin etiqueta
 * (a11y-label). Si no hay campos y `allowImageFallback`, usa una imagen sin alt (a11y-img-alt).
 * Devuelve null si no ha podido provocar un fallo real.
 */
export function injectDemoDefect(delivered: GeneratedFile[], allowImageFallback: boolean): DemoDefect | null {
  const jsx = delivered.filter((f) => isJsxFile(f.path));
  const apply = (fix: (f: GeneratedFile) => { content: string; description: string } | null): DemoDefect | null => {
    for (const f of jsx) {
      const r = fix(f);
      if (r) {
        return {
          files: delivered.map((d) => (d.path === f.path ? { path: d.path, content: r.content } : d)),
          description: `${r.description} en ${f.path}`,
        };
      }
    }
    return null;
  };
  return apply(unlabelField) ?? (allowImageFallback ? apply(breakImage) : null);
}
