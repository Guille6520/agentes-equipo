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
| `check-security.ts` | Sin `dangerouslySetInnerHTML`, `eval`, `new Function`, claves plausibles (`nvapi-`, `AIza`, `postgresql://`, `sk-`) ni `fetch` a dominios externos (lista `ALLOWED_FETCH_HOSTS`). |
| `check-render.ts` | Transpila a CommonJS y renderiza con `renderToStaticMarkup` dentro de `node:vm` (timeout 2 s, solo `require` de react/react-dom). Verifica que no lanza y que el HTML tiene form, email, textarea y botón. |

`index.ts` orquesta: sintaxis, a11y, formulario y seguridad se ejecutan siempre; el **render solo
se ejecuta si seguridad y sintaxis están limpias**, porque es el único paso que ejecuta código.

## Advertencia sobre `vm`

`node:vm` **NO es una frontera de seguridad real**: el código ejecutado puede escapar del
contexto (por ejemplo a través de objetos del host como `require` o React). Aquí es
*defensa en profundidad* (sin `process`/`fs`/red, con timeout). La protección principal son los
checks estáticos que se ejecutan antes. En producción se usaría un sandbox más fuerte
(contenedor o microVM, `isolated-vm`, worker aislado sin permisos). Además, el timeout solo
interrumpe código síncrono.

## Limitaciones

- Tipos: solo se resuelven los paquetes instalados (react, react-dom, node...). Los errores de
  "módulo no encontrado" de imports no relativos (`next/link`, `@/...`) se ignoran. Un componente
  que use esos imports no se puede renderizar en el sandbox (falla el render con "Módulo no permitido").
- Los campos del formulario se identifican por `name`/`id`/`type`; si Develop usa otros nombres
  (p. ej. `fullName`) no se detectan.
- La a11y es estática: no ve props dinámicas (`{...props}`) ni contraste, foco o lectores de pantalla.
- Seguridad por patrones: una clave construida por concatenación no se detecta.
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
| `{type:"element", selector, min?}` | tiene al menos `min` (1) elementos; selector = etiqueta permitida (`form`, `button`, `li`, `table`, `nav`, `h1`...) o `input`/`button` con `[type=...]` | `acceptance-element` |
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
