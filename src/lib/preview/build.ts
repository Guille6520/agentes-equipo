// Vista previa en vivo del código generado por Develop.
//
// El servidor transpila los .tsx a módulos ES y genera un documento HTML completo que el navegador
// ejecuta dentro de un <iframe sandbox="allow-scripts allow-forms"> (ver PreviewPane.tsx).
//
// POR QUÉ ESTO SÍ ES UNA FRONTERA DE SEGURIDAD (a diferencia de node:vm en Testing):
// - El código generado NUNCA se ejecuta en el servidor: aquí solo se transpila (TS -> JS, sin evaluar).
// - En el navegador corre en un iframe sandbox SIN allow-same-origin, y además la propia respuesta
//   lleva la directiva CSP `sandbox` (así sigue aislado aunque se abra en una pestaña nueva). El
//   documento tiene un origen OPACO: el navegador le niega las cookies de sesión de la app, su
//   localStorage, y el acceso al DOM del padre (`window.parent.document` lanza). Es el mismo
//   aislamiento entre orígenes que usa el navegador entre webs distintas, no un contexto JS
//   compartido como node:vm, del que se puede escapar a través de los objetos del host.
// - La CSP solo permite scripts del CDN (esm.sh, jsdelivr para Tailwind), los blob: que creamos y
//   los inline con nonce; `connect-src 'none'` impide fetch/XHR/WebSocket y `form-action 'none'`
//   impide enviar formularios a ningún sitio, así que el código no puede llamar a ningún servidor.
//   Sin allow-top-navigation ni allow-popups no puede navegar la pestaña de la app ni abrir ventanas.
//
// QUÉ NO PROTEGE:
// - El contenido del iframe lo controla el código generado: podría mostrar algo engañoso (p. ej. un
//   formulario falso de "inicia sesión"), aunque lo escrito ahí no pueda salir del iframe por red.
// - Puede consumir CPU (un bucle infinito congela el iframe; el navegador lo aísla en lo posible).
// - Puede navegar el PROPIO iframe a otra URL (la CSP no restringe navegaciones del documento).
// - Permitir el host esm.sh entero significa que un import() dinámico podría cargar otros paquetes
//   de npm desde esm.sh; seguirían igual de aislados (sin red ni cookies). Los imports estáticos no
//   permitidos se rechazan aquí al transpilar.
// - Depende de que el navegador implemente sandbox y CSP (todos los actuales lo hacen).
import ts from "typescript";

export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewModule {
  path: string;
  code: string;
  /** Rutas de los módulos generados que importa (ya resueltas). */
  deps: string[];
}

export type PreparedPreview =
  | { ok: true; entry: string; modules: PreviewModule[] }
  | { ok: false; title: string; detail: string };

// Versiones fijadas: coinciden con package.json (react/react-dom 19.3.0, tailwindcss 4.3.3).
const REACT_VERSION = "19.3.0";
const TAILWIND_BROWSER = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3/dist/index.global.js";
const ESM = "https://esm.sh";

/** Importmap: react-dom se pide con ?external=react para que use el MISMO React que el componente. */
const IMPORT_MAP = {
  imports: {
    react: `${ESM}/react@${REACT_VERSION}`,
    "react/jsx-runtime": `${ESM}/react@${REACT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `${ESM}/react@${REACT_VERSION}/jsx-dev-runtime`,
    "react-dom": `${ESM}/react-dom@${REACT_VERSION}?external=react`,
    "react-dom/client": `${ESM}/react-dom@${REACT_VERSION}/client?external=react`,
  },
};
const ALLOWED_BARE = new Set(Object.keys(IMPORT_MAP.imports));

/** Marca que sustituye a los imports relativos; el arranque la cambia por la blob: URL del módulo. */
export const MODULE_TOKEN = "__PREVIEW_MODULE__:";

const CODE_RE = /\.(tsx|ts|jsx|js)$/;
const JSX_RE = /\.(tsx|jsx)$/;
const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

/** Transpila un archivo a ESM y sustituye sus imports relativos por marcas resolubles en el cliente. */
function transpile(path: string, content: string, known: Set<string>): PreviewModule {
  const out = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  const syntaxError = out.diagnostics?.find((d) => d.category === ts.DiagnosticCategory.Error);
  if (syntaxError) {
    const msg = ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n");
    const line =
      syntaxError.file && syntaxError.start !== undefined
        ? syntaxError.file.getLineAndCharacterOfPosition(syntaxError.start).line + 1
        : null;
    throw new Error(`${path}${line ? `:${line}` : ""}: ${msg}`);
  }

  const js = out.outputText;
  const sf = ts.createSourceFile(path + ".js", js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  const edits: { start: number; end: number; text: string }[] = [];
  const deps = new Set<string>();

  const rewrite = (lit: ts.StringLiteralLike) => {
    const spec = lit.text;
    let replacement: string;
    if (spec.startsWith(".")) {
      const base = normalize(`${dirname(path)}/${spec}`);
      const found = EXTENSIONS.map((e) => normalize(base + e)).find((p) => known.has(p));
      if (!found) throw new Error(`${path}: no se encuentra el archivo importado "${spec}".`);
      deps.add(found);
      replacement = JSON.stringify(MODULE_TOKEN + found);
    } else if (ALLOWED_BARE.has(spec)) {
      return;
    } else {
      throw new Error(`${path}: import no permitido en la vista previa: "${spec}" (solo react y archivos generados).`);
    }
    edits.push({ start: lit.getStart(sf), end: lit.getEnd(), text: replacement });
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      rewrite(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      rewrite(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  let code = js;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, e.start) + e.text + code.slice(e.end);
  }
  return { path, code, deps: [...deps] };
}

/**
 * Prepara los módulos de la vista previa.
 * @param own archivos de la tarea mostrada (la entrada sale de aquí)
 * @param deps archivos aprobados de tareas anteriores (se pueden importar; `own` tiene prioridad)
 */
export function preparePreview(own: PreviewFile[], deps: PreviewFile[] = []): PreparedPreview {
  const byPath = new Map<string, string>();
  for (const f of deps) if (CODE_RE.test(f.path)) byPath.set(normalize(f.path), f.content);
  for (const f of own) if (CODE_RE.test(f.path)) byPath.set(normalize(f.path), f.content);

  const ownJsx = own.filter((f) => JSX_RE.test(f.path)).map((f) => ({ ...f, path: normalize(f.path) }));
  if (ownJsx.length === 0) {
    return { ok: false, title: "No hay nada que mostrar", detail: "La tarea no tiene ningún archivo .tsx que renderizar." };
  }

  let modules: PreviewModule[];
  try {
    const known = new Set(byPath.keys());
    modules = [...byPath].map(([p, content]) => transpile(p, content, known));
  } catch (e) {
    return {
      ok: false,
      title: "El código generado no se puede preparar",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // Entrada: un .tsx propio con export default que no importe ningún otro archivo propio
  // (el componente "de más arriba", p. ej. ContactPage que usa ContactForm).
  const withDefault = ownJsx.filter((f) => /export\s+default/.test(f.content));
  const candidates = withDefault.length ? withDefault : ownJsx;
  const importedByOwn = new Set(
    modules.filter((m) => candidates.some((c) => c.path === m.path)).flatMap((m) => m.deps),
  );
  const entry = (candidates.find((c) => !importedByOwn.has(c.path)) ?? candidates[0]).path;
  return { ok: true, entry, modules };
}

/** "components/ContactPage.tsx" -> "Contact Page" */
function pageLabel(entry: string): string {
  const base = entry.split("/").pop()?.replace(CODE_RE, "") ?? "Nueva página";
  return base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim() || "Nueva página";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** JSON seguro dentro de <script>: sin "</script>" ni "<!--" posibles. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** CSP de la respuesta. El nonce autoriza solo nuestros dos <script> inline (importmap y arranque). */
export function previewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${ESM} ${TAILWIND_BROWSER} blob:`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms",
  ].join("; ");
}

export function previewHeaders(nonce: string, status = 200): ResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": previewCsp(nonce),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  };
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// Arranque en el navegador (módulo inline). Sin dependencias: si React no carga, el error se pinta con DOM.
const BOOT = `
const TOKEN = ${JSON.stringify(MODULE_TOKEN)};
const data = JSON.parse(document.getElementById("preview-data").textContent);
const root = document.getElementById("preview-root");
const errorBox = document.getElementById("preview-error");

function describe(err) {
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err);
}
function showError(title, detail) {
  errorBox.replaceChildren();
  const h = document.createElement("p");
  h.className = "font-semibold";
  h.textContent = title;
  const pre = document.createElement("pre");
  pre.className = "mt-2 whitespace-pre-wrap break-words font-mono text-xs";
  pre.textContent = detail || "";
  errorBox.append(h, pre);
  errorBox.hidden = false;
  root.removeAttribute("aria-busy");
}
window.addEventListener("error", (e) => showError("Error al ejecutar el código generado", describe(e.error ?? e.message)));
window.addEventListener("unhandledrejection", (e) => showError("Error al ejecutar el código generado", describe(e.reason)));

async function start() {
  if (data.error) {
    root.replaceChildren();
    showError(data.error.title, data.error.detail);
    return;
  }
  let React, ReactDOMClient;
  try {
    [React, ReactDOMClient] = await Promise.all([import("react"), import("react-dom/client")]);
  } catch (e) {
    showError("No se pudo cargar React desde el CDN (esm.sh)", describe(e));
    return;
  }

  // Cada módulo generado se convierte en una blob: URL; sus imports relativos (marcados en el
  // servidor) se sustituyen por las blob: URLs de sus dependencias, de las hojas hacia arriba.
  const byPath = new Map(data.modules.map((m) => [m.path, m]));
  const urls = new Map();
  const visiting = new Set();
  function urlFor(p) {
    if (urls.has(p)) return urls.get(p);
    if (visiting.has(p)) throw new Error("Importación circular entre archivos generados: " + p);
    visiting.add(p);
    const m = byPath.get(p);
    let code = m.code;
    for (const d of m.deps) code = code.split(JSON.stringify(TOKEN + d)).join(JSON.stringify(urlFor(d)));
    code += "\\n//# sourceURL=" + p;
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    urls.set(p, url);
    return url;
  }

  let mod;
  try {
    mod = await import(urlFor(data.entry));
  } catch (e) {
    showError("El código generado no se pudo cargar", describe(e));
    return;
  }
  const Component = mod.default ?? Object.values(mod).find((v) => typeof v === "function");
  if (typeof Component !== "function") {
    showError("No hay componente que mostrar", data.entry + " no exporta ningún componente (export default).");
    return;
  }

  class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() {
      if (this.state.error) {
        return React.createElement("div", { role: "alert", className: "rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800" },
          React.createElement("p", { className: "font-semibold" }, "El componente lanzó un error al renderizar"),
          React.createElement("pre", { className: "mt-2 whitespace-pre-wrap break-words font-mono text-xs" }, describe(this.state.error)));
      }
      return this.props.children;
    }
  }
  root.replaceChildren();
  root.removeAttribute("aria-busy");
  ReactDOMClient.createRoot(root).render(React.createElement(Boundary, null, React.createElement(Component)));
}
start().catch((e) => showError("Error inesperado en la vista previa", describe(e)));
`;

export interface PreviewDocumentOptions {
  nonce: string;
  prepared: PreparedPreview;
  /** Texto pequeño bajo la cabecera, p. ej. «Tarea · versión 2». */
  caption?: string;
}

/** Documento HTML completo: una "web de ejemplo" con la página generada añadida a su navegación. */
export function renderPreviewDocument({ nonce, prepared, caption }: PreviewDocumentOptions): string {
  const entry = prepared.ok ? prepared.entry : "";
  const label = prepared.ok ? pageLabel(entry) : "Nueva página";
  const isContact = /contact|contacto/i.test(entry);
  const nav = ["Inicio", "Servicios", "Contacto"].map((name) => ({ name, active: isContact && name === "Contacto" }));
  if (!isContact) nav.push({ name: label, active: true });

  const navHtml = nav
    .map(({ name, active }) =>
      active
        ? `<a href="#" aria-current="page" class="rounded-md bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-700">${escapeHtml(name)}</a>`
        : `<a href="#" class="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">${escapeHtml(name)}</a>`,
    )
    .join("");

  const payload = prepared.ok
    ? { entry: prepared.entry, modules: prepared.modules }
    : { error: { title: prepared.title, detail: prepared.detail } };

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mi web · ${escapeHtml(label)} (vista previa)</title>
<style>
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
  [hidden] { display: none !important; }
</style>
<script nonce="${nonce}" src="${TAILWIND_BROWSER}"></script>
<script type="importmap" nonce="${nonce}">${safeJson(IMPORT_MAP)}</script>
</head>
<body class="flex min-h-screen flex-col bg-slate-50 text-slate-900">
<header class="border-b border-slate-200 bg-white">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
    <a href="#" class="text-lg font-bold tracking-tight text-slate-900">Mi web</a>
    <nav aria-label="Principal" class="flex flex-wrap gap-1 text-sm">${navHtml}</nav>
  </div>
</header>
<main class="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
  ${caption ? `<p class="mb-4 text-xs text-slate-400">${escapeHtml(caption)}</p>` : ""}
  <div id="preview-error" role="alert" hidden class="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"></div>
  <div id="preview-root" aria-busy="true"><p class="text-sm text-slate-400">Cargando vista previa…</p></div>
</main>
<footer class="border-t border-slate-200 bg-white">
  <div class="mx-auto max-w-5xl px-6 py-6 text-xs text-slate-500">© Mi web · Web de ejemplo para la vista previa: la página marcada en la navegación es la que han añadido los agentes.</div>
</footer>
<script type="application/json" id="preview-data">${safeJson(payload)}</script>
<script type="module" nonce="${nonce}">${BOOT}</script>
</body>
</html>`;
}
