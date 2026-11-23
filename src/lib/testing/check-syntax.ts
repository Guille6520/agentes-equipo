// Check 1: sintaxis y tipos con la API del compilador de TypeScript, todo en memoria.
//
// Host "virtual": los archivos generados viven solo en memoria (bajo una carpeta
// ficticia dentro del cwd, para que la resolución de módulos encuentre
// node_modules/@types/react). Los archivos de la librería (lib.d.ts, @types/*)
// se leen del disco y se cachean.
//
// LIMITACIÓN documentada: no hay tipos de paquetes que no estén instalados en este
// proyecto (p. ej. `next/link`, alias `@/...`). Los errores "no se encuentra el
// módulo" (TS2307/TS7016) de imports NO relativos se ignoran para no dar falsos positivos.
import ts from "typescript";
import path from "node:path";
import { isCodeFile } from "./ast-utils";
import type { Check, CheckResult } from "./types";

const VIRTUAL_ROOT = path.join(process.cwd(), "__generated__");
const IGNORED_CODES = new Set([2307, 7016]); // módulo no encontrado / sin tipos
const diskCache = new Map<string, ts.SourceFile | null>();

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  lib: ["lib.dom.d.ts", "lib.esnext.d.ts"],
};

export const checkSyntax: Check = (files) => {
  const code = files.filter((f) => isCodeFile(f.path));
  const virtual = new Map(code.map((f) => [path.resolve(VIRTUAL_ROOT, f.path), f.content]));

  const host = ts.createCompilerHost(options);
  host.fileExists = (p) => virtual.has(path.resolve(p)) || ts.sys.fileExists(p);
  host.readFile = (p) => virtual.get(path.resolve(p)) ?? ts.sys.readFile(p);
  host.getSourceFile = (p, lang) => {
    const key = path.resolve(p);
    const mem = virtual.get(key);
    if (mem !== undefined) return ts.createSourceFile(p, mem, lang, true);
    if (!diskCache.has(key)) {
      const text = ts.sys.readFile(p);
      diskCache.set(key, text === undefined ? null : ts.createSourceFile(p, text, lang, true));
    }
    return diskCache.get(key) ?? undefined;
  };

  const program = ts.createProgram([...virtual.keys()], options, host);
  const toResult = (d: ts.Diagnostic): CheckResult => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return {
      id: "syntax",
      name: "Sintaxis y tipos",
      passed: false,
      severity: "error",
      message: `TS${d.code}: ${msg}`,
      file: d.file ? path.relative(VIRTUAL_ROOT, d.file.fileName).replaceAll("\\", "/") : undefined,
      line: pos ? pos.line + 1 : undefined,
    };
  };

  const errors: CheckResult[] = [];
  for (const sf of program.getSourceFiles().filter((s) => virtual.has(path.resolve(s.fileName)))) {
    const syntactic = program.getSyntacticDiagnostics(sf);
    if (syntactic.length) {
      errors.push(...syntactic.map(toResult));
      continue; // con errores de sintaxis los semánticos solo generan ruido
    }
    errors.push(
      ...program
        .getSemanticDiagnostics(sf)
        .filter((d) => !IGNORED_CODES.has(d.code))
        .map(toResult),
    );
  }

  if (errors.length === 0) {
    return [{ id: "syntax", name: "Sintaxis y tipos", passed: true, severity: "error", message: "Sin errores de sintaxis ni de tipos." }];
  }
  return errors;
};
