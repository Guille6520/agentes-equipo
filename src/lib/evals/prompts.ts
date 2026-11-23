// Prompts de las 3 pruebas. Mismos textos que scripts/model-bench.mjs (benchmark del 23/11/2026).
export const P_ORCH = `Eres el agente Orquestador de un equipo de desarrollo. Divide la siguiente petición en entre 3 y 5 tareas.
Petición: "Añade una página de contacto a esta web"
Responde SOLO con JSON válido, sin texto adicional ni bloques markdown, con la forma:
{"tasks":[{"title":"...","description":"..."}]}`;

export const P_DEV = `Genera una página de contacto como UN ÚNICO componente React en TypeScript (TSX), con export default.
Requisitos: formulario con nombre, email y mensaje; validación en cliente con mensajes de error; accesibilidad (labels asociados, atributos aria); manejo de submit con estado de éxito. Sin dependencias externas salvo react.
Devuelve SOLO el código en un bloque \`\`\`tsx.`;

const BUGGY = `function paginate(items, page, size) {
  // page empieza en 1
  const start = page * size;
  return items.slice(start, start + size);
}

async function loadUser(id) {
  const res = fetch("/api/users/" + id);
  return res.json();
}

// tests
test("paginate página 1 devuelve los 2 primeros", () => {
  expect(paginate([1,2,3,4,5], 1, 2)).toEqual([1,2]);
});
test("loadUser devuelve el usuario", async () => {
  expect(await loadUser(7)).toEqual({ id: 7 });
});`;

const FAIL_OUT = `FAIL paginate página 1 devuelve los 2 primeros
  Expected: [1,2]  Received: [3,4]
FAIL loadUser devuelve el usuario
  TypeError: res.json is not a function`;

export const P_TEST = `Eres el agente de Testing. Dado este código y la salida de los tests, resume en pocas líneas qué falla y por qué (causa raíz de cada fallo).

CÓDIGO:
${BUGGY}

SALIDA:
${FAIL_OUT}`;
