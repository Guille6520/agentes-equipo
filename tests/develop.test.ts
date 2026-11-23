import "./setup";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDevelopOutput } from "@/lib/engine/develop";

const code = "export default function A() {\n  return <div>hola mundo</div>;\n}";

describe("parseDevelopOutput", () => {
  it("lee bloques <file path>", () => {
    const out = parseDevelopOutput(`<file path="components/A.tsx">\n${code}\n</file>`);
    assert.equal(out.files.length, 1);
    assert.equal(out.files[0].path, "components/A.tsx");
    assert.equal(out.files[0].content, code + "\n");
  });
  it("quita la valla markdown dentro del bloque", () => {
    const out = parseDevelopOutput(`<file path="components/A.tsx">\n\`\`\`tsx\n${code}\n\`\`\`\n</file>`);
    assert.equal(out.files[0].content, code + "\n");
  });
  it("acepta varios archivos", () => {
    const out = parseDevelopOutput(
      `<file path="components/A.tsx">\n${code}\n</file>\n<file path="components/B.tsx">\n${code}\n</file>`,
    );
    assert.deepEqual(out.files.map((f) => f.path), ["components/A.tsx", "components/B.tsx"]);
  });
  it("acepta el formato JSON de respaldo", () => {
    const out = parseDevelopOutput(JSON.stringify({ files: [{ path: "components/A.tsx", content: code }] }));
    assert.equal(out.files[0].path, "components/A.tsx");
  });
  it("rechaza rutas fuera de components/", () => {
    assert.throws(() => parseDevelopOutput(`<file path="../evil.tsx">\n${code}\n</file>`), /ruta no permitida/);
  });
  it("rechaza rutas repetidas", () => {
    assert.throws(
      () => parseDevelopOutput(`<file path="components/A.tsx">\n${code}\n</file><file path="components/A.tsx">\n${code}\n</file>`),
      /rutas repetidas/,
    );
  });
  it("rechaza si no hay ningún .tsx", () => {
    assert.throws(() => parseDevelopOutput(`<file path="components/a.ts">\n${code}\n</file>`), /al menos un \.tsx/);
  });
  it("rechaza texto sin archivos ni JSON", () => {
    assert.throws(() => parseDevelopOutput("lo siento"), /no hay JSON/);
  });
});
