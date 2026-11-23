# Seguimiento del prompt: cómo responde cada modelo a los prompts reales del motor

Medición del 23/11/2026 para decidir qué modelo debe ser el **principal** de los tres agentes y cuáles los respaldos. A diferencia de [`seleccion-de-modelos.md`](./seleccion-de-modelos.md), que usó los prompts simplificados de `/evals`, aquí cada modelo recibe **los prompts de sistema reales del motor** (`ORCHESTRATOR_INSTRUCTIONS`, `DEVELOP_INSTRUCTIONS`, `TESTING_INSTRUCTIONS`) y el mismo formato de prompt de usuario que construyen `planRun`, `developTask` y `testTask`.

Script: [`scripts/bench-prompts.ts`](../scripts/bench-prompts.ts). Los resultados en bruto (incluido el texto de cada respuesta) quedan en `scripts/.bench-prompts/`, carpeta ignorada por git.

## 1. Metodología

**Candidatos:** `poolside/laguna-xs-2.1` (NVIDIA, principal actual), `openai/gpt-oss-20b` y `openai/gpt-oss-120b` (Groq). `gemini-3.1-flash-lite` se probó con una sonda (el prompt real del Orquestador) y devolvió **HTTP 503 en 0,9 s**, así que se dejó fuera del resto de pruebas, tal como estaba previsto.

**Parámetros iguales a los del motor:** temperatura 0,2; `maxOutputTokens` 2048 (Orquestador), 8192 (Develop) y 1024 (Testing); timeout 30 s, 45 s y 30 s. Cada llamada va a **un solo modelo, sin respaldo ni reintento** (solo se habría repetido una vez tras un 429, y no hubo ninguno).

**Pruebas (3 repeticiones de cada una por modelo, 63 llamadas en total):**

- **A. Orquestador**, 4 peticiones: «Añade una página de contacto a esta web», «Crea una tabla de precios con tres planes», «Hazme un vídeo de un gato bailando» (debe declararse fuera de alcance) y «Crea un logotipo en SVG de una taza de café» (debe planificarse). Se mide: JSON válido según `planSchema` al primer intento (con el mismo `parseJson` del motor), JSON estricto (sin texto ni vallas alrededor), nº de tareas, criterios válidos y descartados (`parseAcceptance`, que descarta los inválidos, los repetidos y los que pasan de 5) y si la decisión de alcance es correcta.
- **B. Develop**, 2 tareas fijas con 5 criterios cada una: formulario de contacto (perfil `contact-form`: encabezado «Contacto», campos `name` y `email` obligatorios, `<textarea>`, texto «Enviar») y tabla de precios (perfil `basic`: encabezado «Precios», textos «Básico» y «Empresa», al menos 3 `<button>` y 6 `<li>`). Se mide: formato `<file path>` interpretable por `parseDevelopOutput` y si pasa `runChecks` con su perfil y criterios **a la primera**.
- **C. Testing (feedback)**: un componente con **dos fallos conocidos** (input de email con `type="text"` e `<img>` sin `alt`). Se pasa el informe real de `runChecks`, que lista 3 errores: los dos fallos y, como consecuencia del primero, el render que no encuentra el campo email. Heurística: el feedback menciona el `type="email"` y el `alt`.

**Runs completos:** con cada candidato como principal (cambiando `ROLE_MODELS` **solo en la memoria del proceso del script**; el código no cambia) y los otros dos como respaldos, se ejecutó `advanceRun` en bucle (igual que `scripts/e2e-engine.ts`) para dos peticiones marcadas «[prueba prompts]». Después se borraron esos 6 runs y se comprobó que en la BD siguen los runs 2, 3, 7, 10, 18 y 19.

**Ritmo y límites:** limitador de ventana deslizante de 60 s por modelo de Groq con presupuesto de 7.200 tokens (límite gratuito: 8.000 tokens/min y 1.000 peticiones/día por modelo) y al menos 2 s entre llamadas a NVIDIA (~40 peticiones/min). Antes de cada run completo, 65 s de pausa. Un contador sobre `fetch` registró todas las peticiones HTTP a los proveedores y sus códigos: **0 respuestas 429** en todo el estudio (63 + 18 peticiones).

## 2. Resultados por prueba

### A. Orquestador (12 llamadas por modelo)

| Modelo | JSON válido (planSchema) | Alcance correcto | Tareas por plan | Criterios válidos / descartados | Planes sin criterios | Latencia media | Tokens medios (entrada / salida / razonamiento) |
|---|---|---|---|---|---|---|---|
| `laguna-xs-2.1` | **9/12** | 9/12 (3 sin plan por JSON roto) | 1 | 22 / 13 | 0 | 3,3 s | 839 / 136 / 0 |
| `gpt-oss-20b` | 12/12 | 12/12 | 1 | 27 / 5 | 3 (los 3 del logotipo) | 1,0 s | 740 / 470 / 393 |
| `gpt-oss-120b` | 12/12 | 12/12 | 1 | 32 / 7 | 1 (logotipo) | 1,2 s | 740 / 390 / 245 |

Por petición (aciertos sobre 3):

| Petición | laguna | gpt-oss-20b | gpt-oss-120b |
|---|---|---|---|
| Página de contacto | 1/3 | 3/3 | 3/3 |
| Tabla de precios | 3/3 | 3/3 | 3/3 |
| Vídeo de un gato (fuera de alcance) | 3/3 | 3/3 | 3/3 |
| Logotipo SVG (debe planificarse) | 2/3 | 3/3 | 3/3 |

Todos los planes válidos tuvieron **una sola tarea**, coherente con la regla «usa una sola tarea si la petición es pequeña».

### B. Develop (6 llamadas por modelo)

| Modelo | Formato `<file>` válido | Pasa `runChecks` a la primera | Contacto | Precios | Criterios cumplidos | Latencia media | Tokens medios (entrada / salida / razonamiento) | Máximo total |
|---|---|---|---|---|---|---|---|---|
| `laguna-xs-2.1` | 6/6 | 4/6 | 1/3 | 3/3 | 30/30 | 17,6 s | 587 / 1.157 / 0 | 1.953 |
| `gpt-oss-20b` | 6/6 | **6/6** | 3/3 | 3/3 | 30/30 | 1,6 s | 553 / 1.111 / 337 | 1.890 |
| `gpt-oss-120b` | 6/6 | 2/6 | 0/3 | 2/3 | 14/30 | 2,8 s | 553 / 1.082 / 346 | 1.839 |

Fallos concretos:

- `laguna-xs-2.1`, contacto (2 de 3): `form-feedback`, falta la región `role="alert"`/`aria-live` que pide el prompt. Los 5 criterios sí se cumplieron.
- `gpt-oss-120b`, 3 de 6: `TS2503: Cannot find namespace 'JSX'` (anota el retorno como `JSX.Element`, que no existe sin importarlo en React 19). Al no compilar, no hay render y los 5 criterios quedan sin comprobar (0/5). En otra llamada (contacto) repartió el código en dos archivos y el componente que se renderiza no tenía el encabezado «Contacto» (4/5).

### C. Testing, feedback (3 llamadas por modelo)

| Modelo | Menciona los 2 fallos | Líneas no vacías | Cita el archivo | Latencia media | Tokens medios (total / razonamiento) |
|---|---|---|---|---|---|
| `laguna-xs-2.1` | 3/3 | 3, 3, 3 | 0/3 (solo nº de línea) | 2,7 s | 684 / 0 |
| `gpt-oss-20b` | 3/3 | 9, 12, 10 | 3/3 | 0,9 s | 1.131 / 411 |
| `gpt-oss-120b` | 3/3 | 4, 3, 4 | 3/3 | 1,2 s | 933 / 228 |

Una de las tres respuestas de `gpt-oss-20b` se **cortó por el tope de 1.024 tokens** (`finishReason=length`): gastó 898 en razonamiento y el texto quedó a medias. Esa misma respuesta situó el `alt` en la línea 6 (es la 14). Como el motor añade siempre los fallos exactos de los checks después del texto del modelo, el corte no deja a Develop sin información, pero es un aviso.

### Runs completos con cada candidato como principal

| Principal (respaldos) | Petición | Estado | Tiempo total | Intentos | Saltos de respaldo | 429 |
|---|---|---|---|---|---|---|
| `laguna-xs-2.1` (→ 20b → 120b) | Contacto | passed | 29,6 s | 1 | 1 (Orquestador: JSON mal formado dos veces; entró `gpt-oss-20b`) | 0 |
| `laguna-xs-2.1` (→ 20b → 120b) | Precios | passed | 21,6 s | 1 | 0 | 0 |
| `gpt-oss-20b` (→ laguna → 120b) | Contacto | passed | 12,4 s | 2 (`form-required-nombre` y `-mensaje` en el 1.º) | 0 | 0 |
| `gpt-oss-20b` (→ laguna → 120b) | Precios | passed | 6,5 s | 1 | 0 | 0 |
| `gpt-oss-120b` (→ laguna → 20b) | Contacto | passed | 13,0 s | 2 (error de `syntax` en el 1.º) | 0 | 0 |
| `gpt-oss-120b` (→ laguna → 20b) | Precios | passed | 7,4 s | 1 | 0 | 0 |

Los 6 runs terminaron `passed`. Es una muestra de una ejecución por combinación: sirve para ver que el bucle funciona con cada principal, no para comparar tiempos con precisión.

## 3. Cómo responde cada modelo al prompt

**`poolside/laguna-xs-2.1`**

- **Formato:** JSON sin vallas ni texto alrededor cuando acierta, pero en 3 de 12 planes **le faltó una llave de cierre** al final (`...]}]` en vez de `...]}]}`); no fue por el tope de tokens (`finishReason=stop`, ~140 tokens de salida). Le pasó con la petición de contacto 2 de 3 veces. En el run completo ocurrió lo mismo dos veces seguidas (intento y reintento) y el plan lo hizo el respaldo.
- **Criterios:** tiende a pedir **6 o 7 criterios** cuando el máximo es 5 (los que sobran se descartan). En el logotipo pidió selectores SVG (`path`, `circle`, `g`, `line`) que no están en el vocabulario y se descartaron.
- **Develop:** respeta siempre `<file path>`, cumple todos los criterios, pero olvida 2 de 3 veces la región `role="alert"`/`aria-live` del formulario. Es el más lento con diferencia (17,6 s de media; picos de 26 s, cerca del timeout de 45 s).
- **Testing:** feedback de 3 líneas, correcto y conciso, pero sin citar el nombre del archivo.
- **Alcance:** acierta en el vídeo y planifica el logotipo cuando el JSON sale bien; su motivo de «fuera de alcance» copia casi literal la frase del prompt.

**`openai/gpt-oss-20b`**

- **Formato:** 12/12 JSON estrictos; 6/6 en formato `<file>`.
- **Criterios:** nunca pasa de 5 salvo una vez (6). A veces se queda corto (4). Con el logotipo propone solo `svg` (y `path`), que el vocabulario no admite, así que **los 3 planes del logotipo quedaron sin criterios propios** (Testing usaría solo los checks generales).
- **Develop:** 6/6 a la primera en el banco de pruebas, en ~1,6 s. En el run completo de contacto el plan pidió `name`/`message` sin `required` y Develop no marcó como obligatorios «nombre» y «mensaje»; Testing lo detectó y se corrigió en el segundo intento.
- **Testing:** feedback completo y con bloques de código, el más largo (9-12 líneas; el prompt pide como máximo 12). Una vez se cortó por el tope de tokens (ver arriba).
- **Razonamiento:** gasta ~340-410 tokens de razonamiento por llamada, que cuentan para el límite de tokens/min de Groq.

**`openai/gpt-oss-120b`**

- **Formato:** 12/12 JSON estrictos; 6/6 en formato `<file>`.
- **Criterios:** los más completos (32 válidos). Una vez añadió un enlace «Inicio» que no venía a cuento (criterio inventado de más).
- **Develop:** su error típico es **`JSX.Element` como tipo de retorno**, que no compila con TypeScript estricto y React 19 (3 de 6). Es un error de un solo tipo y Testing lo corrige bien en el segundo intento (así pasó en el run completo), pero cuesta una vuelta más del bucle.
- **Testing:** feedback breve (3-4 líneas), cita archivo y línea.

**`gemini-3.1-flash-lite`:** HTTP 503 en la sonda; sin datos de calidad.

**Observaciones sobre el propio prompt (en el momento de la medición; corregidas después, ver la sección 5):**

- El vocabulario de criterios no admite `svg`, `path` ni `circle`, y los tres modelos los piden para un logotipo SVG. Las peticiones de SVG acaban con 0-1 criterios válidos.
- El prompt del Orquestador dice «campos (nombre, email, mensaje)» y el de Develop dice `name`, `email`, `message`. Los modelos mezclan ambos: a veces el Orquestador exige `name="nombre"` y Develop lo sigue. No rompió ningún run, pero es una fuente de inconsistencia.

## 4. Consumo de tokens frente al límite de Groq (8.000 tokens/min por modelo)

| Llamada (gpt-oss-20b) | Tokens totales medios | Máximo observado | Llamadas que caben por minuto (media / peor caso) |
|---|---|---|---|
| Orquestador | 1.210 | 1.740 | ~6 / ~4 |
| Develop (primer intento, sin dependencias) | 1.664 | 1.890 | **~4 / ~4** |
| Testing (feedback) | 1.131 | 1.582 | ~7 / ~5 |

- **Develop: caben unas 4 llamadas por minuto y modelo** (8.000 / 1.890). Con `gpt-oss-120b` es parecido (media 1.635, máximo 1.839). Las correcciones llevan además el código anterior y el feedback en la entrada, así que consumen más; no se midieron por separado.
- Un run de una tarea que pasa a la primera son 2 llamadas (~2.900 tokens); con una corrección, 4 llamadas (unos 6.000 tokens según las medias, más por la entrada de la corrección). Es decir, **un solo run con una corrección ya usa casi todo el minuto de un modelo de Groq**. Dos usuarios a la vez con Groq de principal llegarían al 429.
- Por peticiones/día (1.000 por modelo) caben entre ~170 y ~500 runs diarios (2-6 llamadas por run): no es el cuello de botella.
- El `maxOutputTokens` de 8.192 de Develop supera por sí solo los 8.000 tokens/min, pero Groq **no rechazó ninguna llamada** por ello (ningún 413 ni 429); se contabilizan los tokens realmente usados.
- Con el ritmo usado (presupuesto de 7.200 tokens/min por modelo) el limitador tuvo que esperar entre 1 y 29 s varias veces, y no hubo ningún 429.

## 5. Recomendación

**Orden propuesto (igual en los tres roles): `gpt-oss-20b` (Groq) → `laguna-xs-2.1` (NVIDIA) → `gpt-oss-120b` (Groq).** Gemini, mientras dé 503, fuera de la cadena o al final.

Por qué:

1. **`gpt-oss-20b` de principal:** fue el único sin fallos en los prompts reales: 12/12 planes válidos y con el alcance correcto, 6/6 componentes que pasan los checks a la primera y 3/3 feedbacks con los dos fallos. Además es el más rápido (1,0 s planificando y 1,6 s en Develop, frente a 3,3 s y 17,6 s de Laguna).
2. **`laguna-xs-2.1` de primer respaldo:** es **otro proveedor**, así que cubre justo el riesgo principal de `gpt-oss-20b` (429 por el límite de tokens/min de Groq o una caída de Groq). Su calidad es aceptable para respaldo: 4/6 en Develop y JSON roto en 3/12 planes, que el reintento del primario no siempre arregla.
3. **`gpt-oss-120b` en último lugar:** planifica muy bien (12/12), pero en Develop solo pasó 2/6 a la primera por el `JSX.Element`. Además comparte proveedor con el principal: si Groq cae, cae también; solo ayuda si el 429 es de cuota de `gpt-oss-20b` (el límite es por modelo).

Riesgos de este orden:

- **Cuota de Groq:** 8.000 tokens/min por modelo da para ~1 run con corrección por minuto. Con varios runs a la vez habrá 429; la cadena esperará 6 s, reintentará y pasará a Laguna. Es el motivo para poner un proveedor distinto como primer respaldo.
- **Tope de Testing:** el razonamiento de `gpt-oss-20b` cortó 1 de 3 feedbacks a 1.024 tokens. El motor añade igualmente los fallos exactos de los checks, pero convendría valorar subir ese tope si `gpt-oss-20b` pasa a ser el principal.
- **Plan gratuito:** las condiciones de Groq (como las de NVIDIA o Google) pueden cambiar.
- **Muestra pequeña:** una diferencia de 6/6 frente a 4/6 es una señal, no una prueba estadística (ver limitaciones).

Alternativa conservadora: mantener Laguna de principal y poner `gpt-oss-20b` como primer respaldo en lugar de Gemini. Se pierde velocidad y se aceptan los fallos de JSON de Laguna, pero el principal no depende de un límite de tokens tan ajustado.

La decisión y el cambio en `ROLE_MODELS` (`src/lib/ai/models.ts`) quedan para el responsable del proyecto: este informe no cambia el orden real.

**Actualización:** se adoptó el orden propuesto (`gpt-oss-20b` → `laguna-xs-2.1` → `gpt-oss-120b`), se subió el tope del feedback de Testing a 2.048 tokens y se corrigieron las dos observaciones sobre el prompt de la sección 3 (vocabulario SVG y nombres de campos). Ver [`seleccion-de-modelos.md`](./seleccion-de-modelos.md). Los prompts del motor también se endurecieron después contra prompt injection (contenido del usuario delimitado entre etiquetas); `scripts/bench-prompts.ts` conserva el formato de mensaje del momento de la medición.

## 6. Limitaciones

- **Muestras pequeñas:** 3 repeticiones por prueba, 4 peticiones al Orquestador, 2 tareas de Develop, 1 caso de Testing y 1 run completo por combinación. No hay intervalos de confianza.
- **Heurísticas:** el acierto de Testing se mide con expresiones regulares (menciona `type="email"` y `alt`), no por revisión humana. «Pasa los checks» significa que pasa `runChecks`, no que el componente sea bueno en un navegador.
- **Solo primer intento en Develop** en las pruebas aisladas: no se midió cómo corrige cada modelo con feedback salvo en los runs completos (2 correcciones en total, ambas resueltas a la primera).
- **Tokens de las correcciones y de los runs completos** no medidos por llamada; las cifras de consumo de la sección 4 vienen de las pruebas aisladas.
- **Una sola franja horaria** (23/11/2026 por la tarde). La latencia de NVIDIA y la disponibilidad de Gemini varían con la carga.
- **Gemini sin medir** por el 503 de la sonda.
- **Sin concurrencia:** las llamadas fueron secuenciales y espaciadas, así que no se ha observado cómo se comporta la cadena cuando Groq devuelve 429 de verdad.

## 7. Cómo reproducirlo

```bash
npx tsx scripts/bench-prompts.ts --phase=selftest   # comprueba los datos fijos, sin red
npx tsx scripts/bench-prompts.ts --phase=calls      # pruebas A, B y C (3 repeticiones, 63 llamadas)
npx tsx scripts/bench-prompts.ts --phase=runs       # runs completos con cada candidato como principal (crea runs en la BD)
npx tsx scripts/bench-prompts.ts --phase=cleanup    # borra los runs «[prueba prompts]»
```

Requiere `NVIDIA_API_KEY`, `GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` y `DATABASE_URL` en `.env.local`. **La BD es la de producción:** la fase `runs` crea runs reales (marcados «[prueba prompts]») y hay que ejecutar `cleanup` después.
