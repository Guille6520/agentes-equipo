# Módulo de testing determinista

Comprueba el código que genera el agente **Develop** sin usar ningún LLM. El LLM solo se
usará después, para redactar mejor el feedback a partir de `TestReport.failures`.

```ts
import { runChecks } from "@/lib/testing";
const report = await runChecks([{ path: "ContactPage.tsx", content }]);
report.passed;   // true solo si no hay fallos de severidad "error"
report.summary;  // texto en español, listo para pasárselo a Develop
```

## Por qué determinista

- Mismo código, mismo veredicto: reproducible, testeable y sin coste ni latencia de modelo.
- Un LLM que revisa a otro LLM puede equivocarse o ser persuadido; un check no.
- Los fallos llegan con archivo y línea, que es el mejor feedback para corregir.

## Checks (un archivo cada uno)

| Archivo | Qué comprueba |
|---|---|
| `check-syntax.ts` | Compila en memoria con la API de `typescript` (host virtual, `jsx: react-jsx`, `strict`). Errores de sintaxis y de tipos con archivo y línea. |
| `check-a11y.ts` | Recorre el AST: label asociado a input/textarea/select (htmlFor/id, aria-label, aria-labelledby o envuelto en `<label>`), botones con texto, `img` con `alt`, `aria-*` válidos, sin `tabIndex` positivo. |
| `check-contact-form.ts` | `<form onSubmit>`, campos nombre/email/mensaje, email con `type="email"`, `required` (o validación manual en el submit) y región `role="alert"`/`aria-live`. |
| `check-security.ts` | Patrones: sin `dangerouslySetInnerHTML`, `new Function`, claves plausibles (`nvapi-`, `AIza`, `postgresql://`, `sk-`) ni `fetch` a dominios externos (lista `ALLOWED_FETCH_HOSTS`). AST: primitivas de escape del sandbox (ver abajo). |
| `check-render.ts` | Transpila a CommonJS y renderiza con `renderToStaticMarkup` en un **proceso hijo aislado** (`sandbox/render-child.cjs`; dentro, `node:vm` con timeout 2 s y solo `require` de react/react-dom). Verifica que no lanza y que el HTML tiene form, email, textarea y botón. |

`index.ts` orquesta: sintaxis, a11y, formulario y seguridad se ejecutan siempre; el **render solo
se ejecuta si seguridad y sintaxis están limpias**, porque es el único paso que ejecuta código.

## Sandbox del render

**Por qué.** Antes el render corría en el proceso del servidor dentro de `node:vm`, y `node:vm` **no
es una frontera de seguridad**: el contexto recibía objetos del servidor (`require`, React, `console`)
y desde ellos se llega a `Function` del servidor. Una prueba de concepto con una variable falsa lo
confirmó: `(require as any).constructor("return process")()` devolvía el `process` real, leía
`process.env` y sacaba el valor en el mensaje de la excepción, que acababa en el feedback y en los
eventos de la UI. Esa prueba vive ahora en `tests/security.test.ts`.

**Arquitectura actual** (`check-render.ts` + `sandbox/render-child.cjs`):

1. El padre (servidor) transpila TSX -> CommonJS con `typescript` y resuelve las carpetas de
   `react`, `react-dom` y `scheduler`.
2. Lanza `process.execPath` (el mismo Node) con:
   - `env: {}`: el hijo no hereda ninguna variable. En Linux el entorno queda vacío; en Windows libuv
     añade solo variables de sistema (`PATH`, `SYSTEMROOT`, `TEMP`, `USERNAME`…), ninguna secreta.
   - Modelo de permisos de Node con `--allow-fs-read` SOLO para el script del hijo y esas tres
     carpetas. Sin `--allow-child-process`, `--allow-worker`, `--allow-addons` ni `--allow-wasi`, así
     que no puede leer el resto del disco (ni `/proc/self/environ` ni `/proc/<pid del padre>/environ`),
     ni escribir, ni lanzar procesos o workers, ni usar `process.binding`.
   - `--disallow-code-generation-from-strings`: `eval`, `new Function` y `Function("...")` lanzan.
     Además el contexto de vm se crea con `codeGeneration: { strings: false, wasm: false }`.
   - `--max-old-space-size=128` (MB).
3. Comunicación por stdin/stdout en JSON: el padre envía `{ modules, entry, timeoutMs, runtime }` y el
   hijo responde `{ ok, html | error, permission }`.
4. Dos timeouts: el de vm dentro del hijo (2 s, bucles síncronos) y un kill del proceso desde el
   padre a los 10 s (arranque + render), además de un tope de salida de 2 MB.
5. Los mensajes de error se tachan con `redact()` (`src/lib/security/redact.ts`) antes de salir.

**Flag del modelo de permisos.** Se elige en tiempo de ejecución con
`process.allowedNodeEnvironmentFlags`: `--permission` (estable desde Node 23.5 y disponible en
22.13+) o, si no existe, `--experimental-permission` (Node 20-22). En local (Node 22.14) se aceptan
los dos y se usa `--permission`. El hijo comprueba con `process.permission` que está activo y lo
devuelve en la respuesta. Si la versión no tuviera modelo de permisos, el render se ejecuta igual con
el entorno vacío, se escribe un `console.warn` y el mensaje del check lo indica ("aviso: el modelo de
permisos de Node no está activo…"); no falla en silencio. En Vercel (Node 22.x) no se ha podido
comprobar en el despliegue: `tests/security.test.ts` falla si la versión de Node donde corre no lo
tiene activo.

**Checks estáticos contra primitivas de escape** (`check-security.ts`, sobre el AST de TypeScript,
no con regex: «process» en un texto visible, en un atributo o como propiedad `datos.process` no cuenta).
Con cualquiera de estos el render no se ejecuta: acceso a `.constructor` o `["constructor"]`,
`__proto__` (y `__defineGetter__`…), `prepareStackTrace`, referencias a `process`, `globalThis`,
`global`, `Function`, `Reflect`, `require`, `module`, `exports` y `eval`, `import()` dinámico, `with`,
y accesos con nombre calculado por concatenación o llamada (`obj["constr" + "uctor"]`).

**Límites reales:**

- Es un proceso de Node, no un contenedor ni una microVM: comparte kernel y usuario con el servidor.
- El modelo de permisos de Node 22 **no restringe la red**: un código que escapara de vm podría abrir
  conexiones salientes. Ya no tiene secretos que enviar (entorno vacío, sin lectura de disco).
- vm sigue sin ser frontera: un escape del contexto da acceso al `process` del hijo (sin secretos ni
  permisos). Si escapara, también podría escribir en stdout un resultado falso (p. ej. `{ok:true}`):
  afectaría al veredicto de esa tarea, no a los secretos.
- Los checks estáticos no cubren accesos dinámicos con una variable (`obj[clave]`), por eso no son la
  única capa.
- Coste: lanzar el hijo y cargar React en cada render tarda unos 145 ms (mediana) frente a ~9 ms del
  render anterior en proceso con React ya cargado (118 ms la primera vez). Medido con el fixture `ok`,
  10 repeticiones, en Windows con Node 22.14; en Vercel no se ha medido.
- El hijo carga la build de desarrollo de React (no recibe `NODE_ENV`): mensajes de error legibles
  para el feedback, algo más lenta que la de producción.

## Limitaciones

- Tipos: solo se resuelven los paquetes instalados (react, react-dom, node...). Los errores de
  "módulo no encontrado" de imports no relativos (`next/link`, `@/...`) se ignoran. Un componente
  que use esos imports no se puede renderizar en el sandbox (falla el render con "Módulo no permitido").
- Los campos del formulario se identifican por `name`/`id`/`type`; si Develop usa otros nombres
  (p. ej. `fullName`) no se detectan.
- La a11y es estática: no ve props dinámicas (`{...props}`) ni contraste, foco o lectores de pantalla.
- Seguridad por patrones: una clave construida por concatenación no se detecta (el tachado de
  `redact()` cubre los valores reales del entorno si llegaran a un mensaje).
- El render usa el estado inicial del componente: no simula el envío del formulario.
- Cargar el compilador y las `lib.d.ts` tarda ~1-2 s por ejecución (las lib se cachean en memoria).

Perfil: `runChecks(files, { profile: "basic" })` omite los checks de formulario y el render solo exige que no lance y produzca HTML. Por defecto `"contact-form"` (comportamiento original).

## Criterios de aceptación del Orquestador

`runChecks(files, { profile, acceptance })` acepta además criterios que el Orquestador define por
tarea (columna `tasks.acceptance`, jsonb). `check-acceptance.ts` los comprueba sobre el **mismo HTML**
del render en sandbox (`renderAndCheck` en `check-render.ts`, no se renderiza dos veces), es decir,
sobre el estado inicial del componente. Vocabulario cerrado (validado con zod en `acceptance.ts`;
un criterio inválido se descarta sin tumbar el plan; máximo 5 por tarea):

| Criterio | Pasa si el HTML renderizado... | id del fallo |
|---|---|---|
| `{type:"text", value}` | contiene ese texto visible (sin distinguir mayúsculas ni tildes; incluye el `value` de `<input type="submit">`) | `acceptance-text` |
| `{type:"element", selector, min?}` | tiene al menos `min` (1) elementos; selector = etiqueta permitida (`form`, `button`, `li`, `table`, `nav`, `h1`..., y SVG: `svg`, `path`, `circle`, `rect`, `g`, `line`, `polyline`, `polygon`, `ellipse`) o `input`/`button` con `[type=...]` | `acceptance-element` |
| `{type:"field", name, required?}` | tiene un `input`/`textarea`/`select` con `name` o `id` igual a `name` (y `required`/`aria-required` si se pide) | `acceptance-field` |
| `{type:"heading", text, level?}` | tiene un `h1`-`h6` (o solo `h{level}`) cuyo texto contiene `text` | `acceptance-heading` |
| `{type:"link", text}` | tiene un `<a>` cuyo texto contiene `text` | `acceptance-link` |

Si el render se omite (seguridad o sintaxis) o falla, los criterios quedan **omitidos** (`skipped`),
nunca aprobados. `report.acceptance` trae el recuento y el estado de cada criterio.

## Cómo extenderlo

1. Crea `check-xxx.ts` exportando un `Check = (files) => CheckResult[]` (usa `ast-utils.ts`).
2. Regístralo en `index.ts`.
3. Añade un fixture en `__fixtures__/` (`.tsx.txt`, para que tsc/lint no lo analicen) y su
   entrada en `EXPECTED` de `run-fixtures.ts`.

## Probar

```
npx tsx src/lib/testing/run-fixtures.ts
```

Imprime una tabla OK/FAIL por fixture y sale con código 1 si alguno no coincide. Las claves de
los fixtures son falsas a propósito.
