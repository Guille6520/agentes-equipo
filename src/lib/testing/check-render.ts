// Check 5: render aislado.
//
// El código generado se transpila aquí (TSX -> CommonJS) y se ejecuta en un PROCESO HIJO
// (sandbox/render-child.cjs), no en el proceso del servidor:
// - `env: {}`: el hijo no hereda ninguna variable (ni claves de API ni DATABASE_URL).
// - Modelo de permisos de Node: solo puede leer react/react-dom/scheduler y su propio script; no puede
//   leer el resto del disco (ni /proc/<pid>/environ del padre), ni lanzar procesos ni workers.
// - `--disallow-code-generation-from-strings`: sin eval/new Function/Function("...") en el hijo.
// - Límite de memoria y timeout doble: el de vm dentro del hijo (bucles síncronos) y un kill del
//   proceso desde aquí si no responde.
// Dentro del hijo se sigue usando node:vm para cargar los módulos; vm NO es una frontera de seguridad,
// la frontera es el proceso. Antes del render, check-security.ts bloquea las primitivas de escape.
// Detalles y límites reales: README.md de este módulo ("Sandbox del render").
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { redact } from "@/lib/security/redact";
import { isCodeFile, isJsxFile } from "./ast-utils";
import type { CheckResult, GeneratedFile } from "./types";

const NAME = "Render en sandbox";
/** Tiempo máximo del código del componente dentro del hijo (timeout de vm). */
const TIMEOUT_MS = 2000;
/** Tiempo máximo del proceso hijo completo (arranque + carga de React + render) antes de matarlo. */
const PROCESS_TIMEOUT_MS = 10_000;
const MAX_OLD_SPACE_MB = 128;
const MAX_OUTPUT = 2 * 1024 * 1024;

/** Ruta del script del hijo. Se resuelve desde la raíz del proyecto (en Vercel, /var/task), donde lo deja outputFileTracingIncludes. */
export const CHILD_SCRIPT = path.join(process.cwd(), "src", "lib", "testing", "sandbox", "render-child.cjs");

// react/react-dom se cargan en el hijo desde node_modules. Aquí solo se resuelven sus carpetas (el nombre
// del módulo va en una variable para que el bundler no intente empaquetarlo).
const runtimeRequire = createRequire(path.join(process.cwd(), "package.json"));
let runtimeDirs: { react: string; reactDom: string; read: string[] } | null = null;
function reactDirs() {
  if (!runtimeDirs) {
    const dirOf = (pkg: string, from?: string) => {
      const req = from ? createRequire(path.join(from, "package.json")) : runtimeRequire;
      return path.dirname(req.resolve(`${pkg}/package.json`));
    };
    const react = dirOf("react");
    const reactDom = dirOf("react-dom");
    const read = [react, reactDom];
    try {
      read.push(dirOf("scheduler", reactDom));
    } catch {
      // react-dom/server no necesita scheduler en todas las versiones.
    }
    // Si node_modules usa enlaces simbólicos, el hijo lee las rutas reales.
    const withReal = read.flatMap((d) => {
      const real = fs.realpathSync(d);
      return real === d ? [d] : [d, real];
    });
    runtimeDirs = { react, reactDom, read: withReal };
  }
  return runtimeDirs;
}

/** Flag del modelo de permisos que acepta esta versión de Node (`--permission` desde 22.13/23.5; antes `--experimental-permission`). */
export function permissionFlag(): string | null {
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags.has("--permission")) return "--permission";
  if (flags.has("--experimental-permission")) return "--experimental-permission";
  return null;
}

let warned = false;
const NO_PERMISSION_NOTE =
  "aviso: el modelo de permisos de Node no está activo en esta versión; el render se aisló solo con un proceso sin variables de entorno";
function warnNoPermission() {
  if (warned) return;
  warned = true;
  console.warn(`[testing] ${NO_PERMISSION_NOTE}.`);
}

const result = (passed: boolean, message: string, extra: Partial<CheckResult> = {}): CheckResult => ({
  id: "render", name: NAME, passed, severity: "error", message: redact(message), ...extra,
});

export interface IsolatedRenderOptions {
  /**
   * SOLO para tests: da al código el `process` real del hijo, como si ya hubiera escapado del contexto
   * de vm, para comprobar que el proceso no tiene secretos ni permisos. Nunca se usa en el motor.
   */
  simulateEscape?: boolean;
}

type RenderOutcome = { ok: true; html: string; permission: boolean } | { ok: false; error: string; permission: boolean };
export type IsolatedRenderResult = RenderOutcome & { ms: number };

/** Transpila los archivos y los renderiza en el proceso hijo. No lanza: los fallos vienen en `error`. */
export function renderIsolated(
  files: GeneratedFile[],
  entry: GeneratedFile,
  options: IsolatedRenderOptions = {},
): Promise<IsolatedRenderResult> {
  const t0 = Date.now();
  const modules: Record<string, string> = {};
  for (const f of files.filter((x) => isCodeFile(x.path))) {
    // Transpila TSX -> JS CommonJS (sin comprobar tipos: eso ya lo hizo el check 1).
    modules[path.posix.normalize(f.path)] = ts.transpileModule(f.content, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    }).outputText;
  }
  const dirs = reactDirs();
  const flag = permissionFlag();
  if (!flag) warnNoPermission();
  const args = [
    ...(flag ? [flag, ...[CHILD_SCRIPT, ...dirs.read].map((d) => `--allow-fs-read=${d}`)] : []),
    "--disallow-code-generation-from-strings",
    `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
    "--no-warnings",
    CHILD_SCRIPT,
  ];
  const payload = JSON.stringify({
    modules,
    entry: path.posix.normalize(entry.path),
    timeoutMs: TIMEOUT_MS,
    runtime: { react: dirs.react, reactDom: dirs.reactDom },
    ...(options.simulateEscape ? { simulateEscape: true } : {}),
  });

  return new Promise((resolve) => {
    let settled = false;
    let out = "";
    let err = "";
    const done = (r: RenderOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!r.permission) warnNoPermission();
      resolve({ ...r, ms: Date.now() - t0 });
    };
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, args, {
      env: {} as NodeJS.ProcessEnv, // Ninguna variable del padre (en Windows libuv añade solo PATH, SYSTEMROOT y similares).
      stdio: "pipe",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ ok: false, error: `El render no terminó en ${PROCESS_TIMEOUT_MS} ms y se detuvo el proceso (posible bucle infinito)`, permission: !!flag });
    }, PROCESS_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
      if (out.length > MAX_OUTPUT) {
        child.kill("SIGKILL");
        done({ ok: false, error: "El render produjo demasiada salida y se detuvo el proceso", permission: !!flag });
      }
    });
    child.stderr.on("data", (d: string) => {
      if (err.length < 4000) err += d;
    });
    child.on("error", (e) => done({ ok: false, error: `No se pudo lanzar el proceso de render: ${e.message}`, permission: false }));
    child.on("close", (code, signal) => {
      try {
        const parsed = JSON.parse(out) as { ok?: unknown; html?: unknown; error?: unknown; permission?: unknown };
        const permission = parsed.permission === true;
        if (parsed.ok === true && typeof parsed.html === "string") done({ ok: true, html: parsed.html, permission });
        else done({ ok: false, error: String(parsed.error ?? "error desconocido"), permission });
      } catch {
        const why = /heap out of memory|Allocation failed/i.test(err)
          ? `superó el límite de memoria (${MAX_OLD_SPACE_MB} MB)`
          : `terminó sin respuesta (código ${code ?? "-"}${signal ? `, señal ${signal}` : ""})`;
        done({ ok: false, error: `El proceso de render ${why}`, permission: !!flag });
      }
    });
    child.stdin.on("error", () => {}); // El hijo puede cerrar stdin antes (entrada demasiado grande).
    child.stdin.end(payload);
  });
}

export type RenderExpect = "contact-form" | "form" | "none";

/**
 * Render + comprobaciones de estructura. Devuelve también el HTML (null si no se pudo renderizar)
 * para que otros checks (criterios del Orquestador) lo reutilicen sin renderizar dos veces.
 */
export async function renderAndCheck(
  files: GeneratedFile[],
  { expect = "contact-form" }: { expect?: RenderExpect } = {},
): Promise<{ results: CheckResult[]; html: string | null; entry?: string }> {
  const jsx = files.filter((f) => isJsxFile(f.path));
  if (jsx.length === 0) return { results: [result(false, "No hay ningún archivo .tsx/.jsx que renderizar.")], html: null };
  const entry = jsx.find((f) => /export\s+default/.test(f.content)) ?? jsx[0];

  const r = await renderIsolated(files, entry);
  const note = r.permission ? "" : ` (${NO_PERMISSION_NOTE})`;
  if (!r.ok) {
    const timeout = /timed out/i.test(r.error) ? ` (excedió ${TIMEOUT_MS} ms: posible bucle infinito)` : "";
    return {
      results: [result(false, `El componente lanza una excepción al renderizar: ${r.error}${timeout}${note}`, { file: entry.path })],
      html: null,
      entry: entry.path,
    };
  }
  const results = structureChecks(r.html, expect, entry.path).map((x) => (note ? { ...x, message: x.message + note } : x));
  return { results, html: r.html, entry: entry.path };
}

/** `expect`: "contact-form" (por defecto) exige form/email/textarea/botón; "form" exige form y botón; "none" solo que renderice. */
export const checkRender = async (files: GeneratedFile[], options: { expect?: RenderExpect } = {}): Promise<CheckResult[]> =>
  (await renderAndCheck(files, options)).results;
function structureChecks(html: string, expect: RenderExpect, file: string): CheckResult[] {
  const entry = { path: file };
  if (expect === "none") {
    if (!html.trim()) return [result(false, "El componente renderiza vacío (no produce HTML).", { file: entry.path })];
    return [result(true, "Renderiza sin excepciones y produce HTML.", { file: entry.path })];
  }

  if (expect === "form") {
    const missingForm = [["<form", /<form[\s>]/], ["botón", /<button[\s>]/]].filter(([, re]) => !(re as RegExp).test(html)).map(([n]) => n);
    if (missingForm.length) return [result(false, `El HTML renderizado no contiene: ${missingForm.join(", ")}.`, { file: entry.path })];
    return [result(true, "Renderiza sin excepciones y contiene form y botón.", { file: entry.path })];
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
}
