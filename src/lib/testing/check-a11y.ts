// Check 2: accesibilidad estática recorriendo el AST (sin ejecutar nada).
import { attrValue, collectJsx, getAttr, hasAttr, insideLabel, lineOf, parseFiles, tagName, type JsxEl } from "./ast-utils";
import type { Check, CheckResult } from "./types";
import ts from "typescript";

const NAME = "Accesibilidad";
const BOOLEAN_ARIA = ["aria-hidden", "aria-required", "aria-disabled", "aria-expanded", "aria-selected", "aria-busy", "aria-atomic", "aria-modal", "aria-readonly", "aria-multiline"];
const TRISTATE_ARIA = ["aria-checked", "aria-pressed"]; // admiten además "mixed"
const KNOWN_ARIA = new Set([
  ...BOOLEAN_ARIA, ...TRISTATE_ARIA,
  "aria-label", "aria-labelledby", "aria-describedby", "aria-live", "aria-invalid", "aria-controls",
  "aria-current", "aria-haspopup", "aria-relevant", "aria-errormessage", "aria-role", "aria-valuenow",
  "aria-valuemin", "aria-valuemax", "aria-valuetext", "aria-orientation", "aria-autocomplete",
  "aria-owns", "aria-activedescendant", "aria-level", "aria-posinset", "aria-setsize", "aria-sort", "aria-placeholder", "aria-roledescription", "aria-details", "aria-flowto", "aria-keyshortcuts", "aria-description",
].filter((n) => n !== "aria-role")); // aria-role NO existe: se detecta como inválido

// Los `input` de estos tipos no necesitan label de texto.
const NO_LABEL_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

export const checkA11y: Check = (files) => {
  const results: CheckResult[] = [];
  for (const { file, sf } of parseFiles(files)) {
    const els = collectJsx(sf);
    const fail = (id: string, node: ts.Node, message: string) =>
      results.push({ id, name: NAME, passed: false, severity: "error", message, file: file.path, line: lineOf(node) });

    // htmlFor de todos los <label> del archivo, para casar con el id de los campos.
    const labelFor = new Set<string>();
    for (const el of els) {
      if (tagName(el) !== "label") continue;
      const a = getAttr(el, "htmlFor");
      if (a) labelFor.add(attrValue(a).text);
    }

    for (const el of els) {
      const tag = tagName(el);
      if (["input", "textarea", "select"].includes(tag)) checkField(el, tag, labelFor, fail);
      if (tag === "button") checkButton(el, fail);
      if (tag === "img" && !hasAttr(el, "alt")) fail("a11y-img-alt", el, "La imagen <img> no tiene atributo alt (usa alt=\"\" si es decorativa).");
      checkAria(el, fail);
      const ti = getAttr(el, "tabIndex");
      if (ti && Number(attrValue(ti).text) > 0) fail("a11y-tabindex", el, "tabIndex positivo: rompe el orden natural de tabulación. Usa 0 o -1.");
    }
  }
  if (results.length === 0) {
    return [{ id: "a11y", name: NAME, passed: true, severity: "error", message: "Sin problemas de accesibilidad detectados." }];
  }
  return results;
};

type Fail = (id: string, node: ts.Node, message: string) => void;

function checkField(el: JsxEl, tag: string, labelFor: Set<string>, fail: Fail) {
  const typeAttr = getAttr(el, "type");
  if (tag === "input" && typeAttr && NO_LABEL_INPUT_TYPES.has(attrValue(typeAttr).text)) return;
  if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby")) return;
  const id = getAttr(el, "id");
  if (id && labelFor.has(attrValue(id).text)) return;
  if (insideLabel(el)) return;
  fail("a11y-label", el, `El campo <${tag}> no tiene label asociado (htmlFor/id, aria-label, aria-labelledby o envuelto en <label>).`);
}

function checkButton(el: JsxEl, fail: Fail) {
  if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby") || hasAttr(el, "title")) return;
  // Un botón autocerrado no tiene contenido; si no, miramos sus hijos.
  if (ts.isJsxOpeningElement(el)) {
    const parent = el.parent as ts.JsxElement;
    const hasContent = parent.children.some(
      (c) => (ts.isJsxText(c) && c.text.trim() !== "") || ts.isJsxExpression(c) || ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
    );
    if (hasContent) return;
  }
  fail("a11y-button", el, "El <button> no tiene texto accesible (contenido, aria-label o aria-labelledby).");
}

function checkAria(el: JsxEl, fail: Fail) {
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    const name = a.name.getText();
    if (!name.startsWith("aria-")) continue;
    if (!KNOWN_ARIA.has(name)) {
      fail("a11y-aria", a, `Atributo ${name} no válido (no existe en WAI-ARIA).`);
      continue;
    }
    const v = attrValue(a);
    if (v.kind !== "string") continue; // expresiones dinámicas: no se pueden validar
    const ok =
      (BOOLEAN_ARIA.includes(name) && ["true", "false"].includes(v.text)) ||
      (TRISTATE_ARIA.includes(name) && ["true", "false", "mixed"].includes(v.text)) ||
      (name === "aria-live" && ["off", "polite", "assertive"].includes(v.text)) ||
      (name === "aria-invalid" && ["true", "false", "grammar", "spelling"].includes(v.text)) ||
      (name === "aria-label" && v.text.trim() !== "") ||
      !(BOOLEAN_ARIA.includes(name) || TRISTATE_ARIA.includes(name) || ["aria-live", "aria-invalid", "aria-label"].includes(name));
    if (!ok) fail("a11y-aria", a, `Valor "${v.text}" no válido para ${name}.`);
  }
}
