// Check 3: estructura mínima de un formulario de contacto (nombre, email, mensaje).
import { attrValue, collectJsx, getAttr, hasAttr, lineOf, parseFiles, tagName, type JsxEl } from "./ast-utils";
import type { Check, CheckResult } from "./types";

const NAME = "Formulario de contacto";
const FIELDS = {
  nombre: /nombre|name/i,
  email: /email|correo|mail/i,
  mensaje: /mensaje|message/i,
} as const;
// Validación manual en el submit (alternativa a `required`).
const MANUAL_VALIDATION = /\.trim\(\)|checkValidity|reportValidity|\.test\(|\.length\s*[<>=]/;

/**
 * Formulario genérico (newsletter, registro, login...): no exige campos concretos como nombre o
 * mensaje. Comprueba <form onSubmit>, que cada campo se valide (required o validación en el submit),
 * que un campo de email use type="email" y que haya una región de mensajes (alert/status/aria-live).
 */
export const checkGenericForm: Check = (files) => {
  const NAME_GENERIC = "Formulario";
  const results: CheckResult[] = [];
  const parsed = parseFiles(files).filter((p) => /\.(tsx|jsx)$/.test(p.file.path));
  const err = (id: string, message: string, file?: string, line?: number) =>
    results.push({ id, name: NAME_GENERIC, passed: false, severity: "error", message, file, line });

  const els = parsed.flatMap(({ file, sf }) => collectJsx(sf).map((el) => ({ el, file: file.path, sf })));
  const form = els.find((e) => tagName(e.el) === "form");
  if (!form) {
    return [{ id: "form-exists", name: NAME_GENERIC, passed: false, severity: "error", message: "No hay ningún elemento <form>." }];
  }
  if (!hasAttr(form.el, "onSubmit")) err("form-onsubmit", "El <form> no tiene onSubmit.", form.file, lineOf(form.el));

  const hasManualValidation = parsed.some((p) => MANUAL_VALIDATION.test(p.file.content));
  const identity = (el: JsxEl) =>
    ["name", "id", "type", "autoComplete"].map((n) => { const a = getAttr(el, n); return a ? attrValue(a).text : ""; }).join(" ");
  const fields = els.filter((e) => {
    const tag = tagName(e.el);
    if (!["input", "textarea", "select"].includes(tag)) return false;
    const type = getAttr(e.el, "type");
    return !(tag === "input" && type && ["hidden", "submit", "button", "reset"].includes(attrValue(type).text));
  });
  if (fields.length === 0) err("form-fields", "El formulario no tiene ningún campo (input, textarea o select).", form.file, lineOf(form.el));

  for (const f of fields) {
    if (FIELDS.email.test(identity(f.el))) {
      const t = getAttr(f.el, "type");
      if (!t || attrValue(t).text !== "email") err("form-email-type", 'El campo de email debe tener type="email".', f.file, lineOf(f.el));
    }
    if (!hasAttr(f.el, "required") && !hasAttr(f.el, "aria-required") && !hasManualValidation) {
      err("form-required", "Un campo no tiene required ni hay validación en el submit.", f.file, lineOf(f.el));
    }
  }

  const feedback = els.some(({ el }) => {
    const role = getAttr(el, "role");
    return (role && ["alert", "status"].includes(attrValue(role).text)) || hasAttr(el, "aria-live");
  });
  if (!feedback) err("form-feedback", 'Falta una región de mensajes de error/éxito con role="alert" (o "status") o aria-live.');

  if (results.length === 0) {
    return [{ id: "form", name: NAME_GENERIC, passed: true, severity: "error", message: "Formulario correcto." }];
  }
  return results;
};

export const checkContactForm: Check = (files) => {
  const results: CheckResult[] = [];
  const parsed = parseFiles(files).filter((p) => /\.(tsx|jsx)$/.test(p.file.path));
  const err = (id: string, message: string, file?: string, line?: number) =>
    results.push({ id, name: NAME, passed: false, severity: "error", message, file, line });

  // Se analiza el conjunto de archivos como un todo (el formulario puede estar repartido).
  const els = parsed.flatMap(({ file, sf }) => collectJsx(sf).map((el) => ({ el, file: file.path, sf })));
  const form = els.find((e) => tagName(e.el) === "form");
  if (!form) {
    return [{ id: "form-exists", name: NAME, passed: false, severity: "error", message: "No hay ningún elemento <form>." }];
  }
  if (!hasAttr(form.el, "onSubmit")) err("form-onsubmit", "El <form> no tiene onSubmit.", form.file, lineOf(form.el));

  const hasManualValidation = parsed.some((p) => MANUAL_VALIDATION.test(p.file.content));
  const inputs = els.filter((e) => ["input", "textarea"].includes(tagName(e.el)));
  const identity = (el: JsxEl) =>
    ["name", "id", "type", "autoComplete"].map((n) => { const a = getAttr(el, n); return a ? attrValue(a).text : ""; }).join(" ");

  for (const [key, re] of Object.entries(FIELDS)) {
    const field = inputs.find((i) => re.test(identity(i.el)));
    if (!field) {
      err(`form-field-${key}`, `Falta el campo "${key}" (se busca por name/id/type que contenga ${re.source}).`);
      continue;
    }
    if (key === "email") {
      const t = getAttr(field.el, "type");
      if (!t || attrValue(t).text !== "email") err("form-email-type", 'El campo email debe tener type="email".', field.file, lineOf(field.el));
    }
    if (!hasAttr(field.el, "required") && !hasAttr(field.el, "aria-required") && !hasManualValidation) {
      err(`form-required-${key}`, `El campo ${key} no tiene required ni hay validación en el submit.`, field.file, lineOf(field.el));
    }
  }

  const feedback = els.some(({ el }) => {
    const role = getAttr(el, "role");
    return (role && ["alert", "status"].includes(attrValue(role).text)) || hasAttr(el, "aria-live");
  });
  if (!feedback) err("form-feedback", 'Falta una región de mensajes de error/éxito con role="alert" (o "status") o aria-live.');

  if (results.length === 0) {
    return [{ id: "form", name: NAME, passed: true, severity: "error", message: "Formulario de contacto completo." }];
  }
  return results;
};
