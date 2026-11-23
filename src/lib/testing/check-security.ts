// Check 4: seguridad e higiene. Dos partes:
// - Patrones línea a línea (claves, dangerouslySetInnerHTML, new Function, fetch externo).
// - Recorrido del AST de TypeScript en busca de primitivas para escapar del sandbox del render
//   (`.constructor`, `__proto__`, `process`, `globalThis`, `Function`, `Reflect`, `require`, `import()`,
//   `with`, `eval`...). Es AST y no regex para no dar falsos positivos con texto visible: «process» en un
//   párrafo o en un atributo no es la variable `process`.
// Se ejecuta ANTES del render: si falla, el código no se ejecuta.
import ts from "typescript";
import { isCodeFile, lineOf, parseFiles } from "./ast-utils";
import type { Check, CheckResult } from "./types";

const NAME = "Seguridad";

/** Dominios externos permitidos en fetch(). Vacío: solo rutas relativas. */
export const ALLOWED_FETCH_HOSTS: string[] = [];

const RULES: { id: string; re: RegExp; message: string }[] = [
  { id: "security-dangerously-html", re: /dangerouslySetInnerHTML/, message: "Uso de dangerouslySetInnerHTML (riesgo de XSS)." },
  { id: "security-new-function", re: /\bnew\s+Function\b/, message: "Uso de new Function()." },
  { id: "security-secret", re: /nvapi-[A-Za-z0-9_-]{8,}/, message: "Posible clave de API de NVIDIA (nvapi-) en el código." },
  { id: "security-secret", re: /AIza[0-9A-Za-z_-]{16,}/, message: "Posible clave de API de Google (AIza) en el código." },
  { id: "security-secret", re: /postgres(?:ql)?:\/\//i, message: "Cadena de conexión a Postgres en el código." },
  { id: "security-secret", re: /\bsk-[A-Za-z0-9_-]{8,}/, message: "Posible clave secreta (sk-) en el código." },
];

const FETCH_RE = /\bfetch\(\s*[`'"](?:https?:)?\/\/([^/'"`\s:?#]+)/g;

/** Identificadores globales que dan acceso al entorno del servidor o a generar código. */
const FORBIDDEN_GLOBALS: Record<string, { id: string; message: string }> = {
  process: { id: "security-process", message: "Acceso a `process` (entorno del servidor); un componente no lo necesita." },
  globalThis: { id: "security-global", message: "Acceso a `globalThis`; usa variables propias del componente." },
  global: { id: "security-global", message: "Acceso a `global`; usa variables propias del componente." },
  Function: { id: "security-function", message: "Uso de `Function` (permite ejecutar código desde cadenas)." },
  Reflect: { id: "security-reflect", message: "Uso de `Reflect`; no hace falta en un componente." },
  require: { id: "security-require", message: "Uso de `require`; importa solo con `import` de \"react\" o archivos relativos." },
  eval: { id: "security-eval", message: "Uso de eval()." },
  module: { id: "security-module", message: "Acceso a `module`; usa `export`." },
  exports: { id: "security-module", message: "Acceso a `exports`; usa `export`." },
};
/** Propiedades que llevan a constructores o prototipos del host (escape típico de node:vm). */
const FORBIDDEN_PROPS: Record<string, { id: string; message: string }> = {
  constructor: { id: "security-constructor", message: "Acceso a `.constructor` (permite llegar a Function y escapar del sandbox)." },
  __proto__: { id: "security-proto", message: "Acceso a `__proto__`." },
  prepareStackTrace: { id: "security-stack", message: "Acceso a `prepareStackTrace` (expone objetos del entorno)." },
  __defineGetter__: { id: "security-proto", message: "Uso de `__defineGetter__`." },
  __defineSetter__: { id: "security-proto", message: "Uso de `__defineSetter__`." },
  __lookupGetter__: { id: "security-proto", message: "Uso de `__lookupGetter__`." },
  __lookupSetter__: { id: "security-proto", message: "Uso de `__lookupSetter__`." },
};

/** ¿Es este identificador una referencia a una variable (y no un nombre de propiedad, atributo JSX o etiqueta)? */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false; // obj.process
  if (ts.isQualifiedName(p) && p.right === id) return false; // NodeJS.Process
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)) && p.name === id) return false;
  if (ts.isJsxAttribute(p)) return false; // <Comp process="..." />
  if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false; // const { process: p } = obj
  if ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.propertyName === id) return false;
  return true;
}

/** Nombre estático de una propiedad accedida con corchetes: obj["constructor"] u obj[`constructor`]. */
const staticKey = (e: ts.Expression): string | undefined =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;

/** Primitivas de escape del sandbox encontradas en el AST. */
function escapePrimitives(files: Parameters<Check>[0]): CheckResult[] {
  const out: CheckResult[] = [];
  for (const { file, sf } of parseFiles(files)) {
    const fail = (rule: { id: string; message: string }, node: ts.Node) =>
      out.push({ id: rule.id, name: NAME, passed: false, severity: "error", message: rule.message, file: file.path, line: lineOf(node) });
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) {
        const rule = FORBIDDEN_GLOBALS[n.text];
        // `new Function(...)` ya lo marca la regla de patrones.
        const isNewFunction = n.text === "Function" && ts.isNewExpression(n.parent) && n.parent.expression === n;
        if (rule && isValueReference(n) && !isNewFunction) fail(rule, n);
        if (n.text === "__proto__" && !ts.isPropertyAccessExpression(n.parent)) fail(FORBIDDEN_PROPS.__proto__, n); // { __proto__: x }
      } else if (ts.isPropertyAccessExpression(n)) {
        const rule = FORBIDDEN_PROPS[n.name.text];
        if (rule) fail(rule, n.name);
      } else if (ts.isElementAccessExpression(n)) {
        const key = staticKey(n.argumentExpression);
        if (key !== undefined) {
          const rule = FORBIDDEN_PROPS[key] ?? FORBIDDEN_GLOBALS[key];
          if (rule) fail(rule, n);
        } else if (ts.isBinaryExpression(n.argumentExpression) || ts.isTemplateExpression(n.argumentExpression) || ts.isCallExpression(n.argumentExpression)) {
          // obj["constr" + "uctor"], obj[`${a}`], obj[parts.join("")]: nombre calculado, no se puede comprobar.
          fail({ id: "security-computed-key", message: "Acceso a una propiedad con nombre calculado (concatenación o llamada); usa un nombre fijo." }, n);
        }
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        fail({ id: "security-dynamic-import", message: "import() dinámico; usa import estático de \"react\" o archivos relativos." }, n);
      } else if (ts.isWithStatement(n)) {
        fail({ id: "security-with", message: "Uso de `with`." }, n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

export const checkSecurity: Check = (files) => {
  const results: CheckResult[] = escapePrimitives(files);
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
