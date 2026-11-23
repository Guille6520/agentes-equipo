// Check 5: render en sandbox.
//
// ADVERTENCIA: `node:vm` NO es una frontera de seguridad real. Un código malicioso
// puede escapar del contexto (p. ej. vía el prototipo de objetos del host que le pasamos).
// Esto es defensa en profundidad: aísla globales (sin process/fs/red) y limita el
// tiempo, pero la protección principal son los checks estáticos de seguridad
// (check-security.ts), que se ejecutan ANTES y, si fallan, este render NO se ejecuta.
// En producción se usaría un sandbox más fuerte (contenedor/microVM, isolated-vm, worker aislado).
import ts from "typescript";
import vm from "node:vm";
import path from "node:path";
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { isCodeFile, isJsxFile } from "./ast-utils";
import type { Check, CheckResult, GeneratedFile } from "./types";

const NAME = "Render en sandbox";
const TIMEOUT_MS = 2000;
const ALLOWED_MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": ReactJsxRuntime,
  "react/jsx-dev-runtime": ReactJsxDevRuntime,
};
const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

const result = (passed: boolean, message: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  id: "render", name: NAME, passed, severity: "error", message, ...extra,
});

/** Renderiza el componente y devuelve el HTML estático. Lanza si algo falla. */
function renderInSandbox(files: GeneratedFile[], entry: GeneratedFile): string {
  const byPath = new Map(files.filter((f) => isCodeFile(f.path)).map((f) => [path.posix.normalize(f.path), f.content]));
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } });
  const cache = new Map<string, { exports: Record<string, unknown> }>();

  const makeRequire = (from: string) => (spec: string): unknown => {
    if (spec in ALLOWED_MODULES) return ALLOWED_MODULES[spec];
    if (spec === "react-dom/server") return { renderToStaticMarkup };
    if (spec.startsWith(".")) {
      const base = path.posix.join(path.posix.dirname(from), spec);
      const found = EXTENSIONS.map((e) => path.posix.normalize(base + e)).find((p) => byPath.has(p));
      if (found) return load(found);
    }
    throw new Error(`Módulo no permitido en el sandbox: "${spec}"`);
  };

  const load = (p: string): Record<string, unknown> => {
    const cached = cache.get(p);
    if (cached) return cached.exports;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(p, mod);
    // Transpila TSX -> JS CommonJS (sin comprobar tipos: eso ya lo hizo el check 1).
    const js = ts.transpileModule(byPath.get(p) ?? "", {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    }).outputText;
    const fn = vm.runInContext(`(function (exports, require, module) {${js}\n})`, context, { filename: p }) as (...a: unknown[]) => void;
    fn(mod.exports, makeRequire(p), mod);
    return mod.exports;
  };

  // Todo el código del usuario se ejecuta dentro de esta llamada, así que el timeout lo cubre.
  (context as Record<string, unknown>).__main = () => {
    const mod = load(path.posix.normalize(entry.path));
    const Component = (mod.default ?? Object.values(mod).find((v) => typeof v === "function")) as React.ComponentType | undefined;
    if (typeof Component !== "function") throw new Error("El archivo no exporta ningún componente (export default).");
    return renderToStaticMarkup(React.createElement(Component));
  };
  return vm.runInContext("__main()", context, { timeout: TIMEOUT_MS }) as string;
}

export const checkRender: Check = (files) => {
  const jsx = files.filter((f) => isJsxFile(f.path));
  if (jsx.length === 0) return [result(false, "No hay ningún archivo .tsx/.jsx que renderizar.")];
  const entry = jsx.find((f) => /export\s+default/.test(f.content)) ?? jsx[0];

  let html: string;
  try {
    html = renderInSandbox(files, entry);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timeout = /timed out/i.test(msg) ? ` (excedió ${TIMEOUT_MS} ms: posible bucle infinito)` : "";
    return [result(false, `El componente lanza una excepción al renderizar: ${msg}${timeout}`, { file: entry.path })];
  }

  const expected: [string, RegExp][] = [
    ["<form", /<form[\s>]/],
    ["campo email", /<input[^>]*type="email"/],
    ["textarea", /<textarea[\s>]/],
    ["botón", /<button[\s>]/],
  ];
  const missing = expected.filter(([, re]) => !re.test(html)).map(([n]) => n);
  if (missing.length) return [result(false, `El HTML renderizado no contiene: ${missing.join(", ")}.`, { file: entry.path })];
  return [result(true, "Renderiza sin excepciones y contiene form, email, textarea y botón.", { file: entry.path })];
};
