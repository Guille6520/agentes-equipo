import "./setup";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { injectDemoDefect } from "@/lib/engine/demo-defect";
import { checkA11y } from "@/lib/testing/check-a11y";

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, "..", "src/lib/testing/__fixtures__", `${n}.tsx.txt`), "utf8");
const failedIds = (files: { path: string; content: string }[]) =>
  (checkA11y(files) as { id: string; passed: boolean }[]).filter((r) => !r.passed).map((r) => r.id);

describe("injectDemoDefect", () => {
  const ok = [{ path: "components/ContactPage.tsx", content: fixture("ok") }];

  it("el fixture válido no tiene fallos de a11y", () => assert.deepEqual(failedIds(ok), []));

  it("quita la etiqueta de un campo y checkA11y falla de verdad", () => {
    const d = injectDemoDefect(ok, false);
    assert.ok(d, "debería generar un defecto");
    assert.match(d.description, /sin etiqueta/);
    assert.ok(failedIds(d.files).includes("a11y-label"));
    assert.notEqual(d.files[0].content, ok[0].content);
  });

  it("no modifica la entrada original", () => {
    const before = ok[0].content;
    injectDemoDefect(ok, false);
    assert.equal(ok[0].content, before);
  });

  it("sin campos: solo usa imagen sin alt si se permite", () => {
    const plain = [{ path: "components/Hero.tsx", content: "export default function Hero() {\n  return <section><h1>Hola</h1></section>;\n}\n" }];
    assert.equal(injectDemoDefect(plain, false), null);
    const d = injectDemoDefect(plain, true);
    assert.ok(d);
    assert.ok(failedIds(d.files).includes("a11y-img-alt"));
  });

  it("ignora archivos que no son JSX", () => {
    assert.equal(injectDemoDefect([{ path: "components/util.ts", content: "export const a = 1;\n" }], true), null);
  });
});
