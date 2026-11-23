// Proceso hijo del render de Testing (ver check-render.ts y README.md, "Sandbox del render").
//
// Lo lanza el servidor con `env: {}` (ninguna variable del padre), el modelo de permisos de Node
// (solo lectura de react/react-dom/scheduler y de este archivo; sin child_process ni worker_threads),
// `--disallow-code-generation-from-strings` y un límite de memoria. Lee un JSON por stdin:
//   { modules: { "<ruta>": "<js CommonJS ya transpilado>" }, entry, timeoutMs, runtime: { react, reactDom } }
// y escribe UN JSON por stdout: { ok: true, html, permission } | { ok: false, error, permission }.
//
// Dentro, el código generado se sigue cargando con node:vm (contexto sin process ni require reales y
// sin generación de código desde cadenas). vm no es una frontera de seguridad: la frontera es el
// proceso. Si el código escapa del contexto, llega a un proceso sin secretos y sin permisos.
/* eslint-disable @typescript-eslint/no-require-imports -- script CommonJS que ejecuta node directamente, sin bundler */
"use strict";

const vm = require("node:vm");
const path = require("node:path");

const MAX_INPUT = 4 * 1024 * 1024;
const MAX_HTML = 1024 * 1024;

function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function permissionActive() {
  try {
    return Boolean(process.permission) && !process.permission.has("fs.read", path.parse(process.cwd()).root);
  } catch {
    return false;
  }
}

function render(input) {
  const { modules, entry, timeoutMs, runtime } = input;
  const React = require(path.join(runtime.react, "index.js"));
  const jsxRuntime = require(path.join(runtime.react, "jsx-runtime.js"));
  const jsxDevRuntime = require(path.join(runtime.react, "jsx-dev-runtime.js"));
  const { renderToStaticMarkup } = require(path.join(runtime.reactDom, "server.node.js"));
  const ALLOWED = { react: React, "react/jsx-runtime": jsxRuntime, "react/jsx-dev-runtime": jsxDevRuntime };
  const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

  const context = vm.createContext(
    { console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } },
    { codeGeneration: { strings: false, wasm: false } },
  );
  const cache = new Map();

  const makeRequire = (from) => (spec) => {
    if (Object.prototype.hasOwnProperty.call(ALLOWED, spec)) return ALLOWED[spec];
    if (spec === "react-dom/server") return { renderToStaticMarkup };
    if (typeof spec === "string" && spec.startsWith(".")) {
      const base = path.posix.join(path.posix.dirname(from), spec);
      const found = EXTENSIONS.map((e) => path.posix.normalize(base + e)).find((p) =>
        Object.prototype.hasOwnProperty.call(modules, p),
      );
      if (found) return load(found);
    }
    throw new Error(`Módulo no permitido en el sandbox: "${spec}"`);
  };

  const load = (p) => {
    const cached = cache.get(p);
    if (cached) return cached.exports;
    const mod = { exports: {} };
    cache.set(p, mod);
    const fn = vm.runInContext(`(function (exports, require, module) {${modules[p]}\n})`, context, { filename: p });
    fn(mod.exports, makeRequire(p), mod);
    return mod.exports;
  };

  // Solo para los tests de regresión: simula que el código ya escapó del contexto de vm dándole el
  // `process` real del hijo. Así se comprueba que, aun así, el proceso no tiene secretos ni permisos.
  if (input.simulateEscape) context.process = process;

  context.__main = () => {
    const mod = load(entry);
    const Component = mod.default ?? Object.values(mod).find((v) => typeof v === "function");
    if (typeof Component !== "function") throw new Error("El archivo no exporta ningún componente (export default).");
    return renderToStaticMarkup(React.createElement(Component));
  };
  return vm.runInContext("__main()", context, { timeout: timeoutMs });
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
  if (raw.length > MAX_INPUT) {
    reply({ ok: false, error: "Entrada demasiado grande para el sandbox.", permission: permissionActive() });
    process.exit(0);
  }
});
process.stdin.on("end", () => {
  const permission = permissionActive();
  let html;
  try {
    html = String(render(JSON.parse(raw)));
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    reply({ ok: false, error: msg.slice(0, 2000), permission });
    return;
  }
  if (html.length > MAX_HTML) {
    reply({ ok: false, error: `El HTML renderizado supera ${MAX_HTML} caracteres.`, permission });
    return;
  }
  reply({ ok: true, html, permission });
});
