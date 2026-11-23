// Utilidades compartidas para recorrer el AST de TypeScript/JSX.
import ts from "typescript";
import type { GeneratedFile } from "./types";

export type JsxEl = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
export type ParsedFile = { file: GeneratedFile; sf: ts.SourceFile };

export const isCodeFile = (path: string) => /\.(tsx|ts|jsx|js)$/.test(path);
export const isJsxFile = (path: string) => /\.(tsx|jsx)$/.test(path);

/** Parsea cada archivo de código (solo sintaxis, sin tipos). */
export function parseFiles(files: GeneratedFile[]): ParsedFile[] {
  return files.filter((f) => isCodeFile(f.path)).map((file) => ({
    file,
    sf: ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.ES2020,
      true, // setParentNodes: necesario para subir por el árbol
      file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  }));
}

/** Todos los elementos JSX (abiertos o autocerrados) del archivo. */
export function collectJsx(sf: ts.SourceFile): JsxEl[] {
  const out: JsxEl[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export const tagName = (el: JsxEl) => el.tagName.getText();

export function getAttr(el: JsxEl, name: string): ts.JsxAttribute | undefined {
  for (const a of el.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name) return a;
  }
  return undefined;
}

export const hasAttr = (el: JsxEl, name: string) => getAttr(el, name) !== undefined;

/**
 * Valor de un atributo: el literal si es string (`type="email"`),
 * el texto de la expresión si es `{...}` (se devuelve tal cual) o "" si no tiene valor (`required`).
 */
export function attrValue(attr: ts.JsxAttribute): { kind: "string" | "expr" | "none"; text: string } {
  const init = attr.initializer;
  if (!init) return { kind: "none", text: "" };
  if (ts.isStringLiteral(init)) return { kind: "string", text: init.text };
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteralLike(e)) return { kind: "string", text: e.text };
    return { kind: "expr", text: e.getText() };
  }
  return { kind: "expr", text: init.getText() };
}

export const lineOf = (n: ts.Node) =>
  n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

/** Sube por el árbol: ¿el elemento está dentro de un <label>? */
export function insideLabel(el: JsxEl): boolean {
  for (let p: ts.Node | undefined = el.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === "label") return true;
  }
  return false;
}
