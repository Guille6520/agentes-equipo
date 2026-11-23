// Check 4: seguridad e higiene. Búsqueda por patrones línea a línea (rápida y predecible).
// Se ejecuta ANTES del render: si falla, el código no se ejecuta.
import { isCodeFile } from "./ast-utils";
import type { Check, CheckResult } from "./types";

const NAME = "Seguridad";

/** Dominios externos permitidos en fetch(). Vacío: solo rutas relativas. */
export const ALLOWED_FETCH_HOSTS: string[] = [];

const RULES: { id: string; re: RegExp; message: string }[] = [
  { id: "security-dangerously-html", re: /dangerouslySetInnerHTML/, message: "Uso de dangerouslySetInnerHTML (riesgo de XSS)." },
  { id: "security-eval", re: /\beval\s*\(/, message: "Uso de eval()." },
  { id: "security-new-function", re: /\bnew\s+Function\b/, message: "Uso de new Function()." },
  { id: "security-secret", re: /nvapi-[A-Za-z0-9_-]{8,}/, message: "Posible clave de API de NVIDIA (nvapi-) en el código." },
  { id: "security-secret", re: /AIza[0-9A-Za-z_-]{16,}/, message: "Posible clave de API de Google (AIza) en el código." },
  { id: "security-secret", re: /postgres(?:ql)?:\/\//i, message: "Cadena de conexión a Postgres en el código." },
  { id: "security-secret", re: /\bsk-[A-Za-z0-9_-]{8,}/, message: "Posible clave secreta (sk-) en el código." },
];

const FETCH_RE = /\bfetch\(\s*[`'"](?:https?:)?\/\/([^/'"`\s:?#]+)/g;

export const checkSecurity: Check = (files) => {
  const results: CheckResult[] = [];
  for (const f of files.filter((x) => isCodeFile(x.path))) {
    f.content.split(/\r?\n/).forEach((line, i) => {
      const fail = (id: string, message: string) =>
        results.push({ id, name: NAME, passed: false, severity: "error", message, file: f.path, line: i + 1 });
      for (const r of RULES) if (r.re.test(line)) fail(r.id, r.message);
      for (const m of line.matchAll(FETCH_RE)) {
        if (!ALLOWED_FETCH_HOSTS.includes(m[1])) fail("security-fetch", `fetch a un dominio externo no permitido: ${m[1]}.`);
      }
    });
  }
  if (results.length === 0) {
    return [{ id: "security", name: NAME, passed: true, severity: "error", message: "Sin patrones inseguros ni secretos." }];
  }
  return results;
};
