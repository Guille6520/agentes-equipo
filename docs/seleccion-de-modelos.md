# Selección de modelos de IA para los tres agentes

Cómo elegí qué modelo mueve a cada agente (Orquestador, Develop y Testing), con qué datos y qué limitaciones tiene la decisión. El detalle de las mediciones está en [`model-comparison.md`](./model-comparison.md) y el benchmark es reproducible con [`scripts/model-bench.mjs`](../scripts/model-bench.mjs).

## 1. Restricciones de partida

- El enunciado pide no gastar dinero: solo planes gratuitos y sin tarjeta.
- La app debe funcionar en directo en Vercel (límites de tiempo serverless) y poder abrirse en cualquier momento.
- Develop tiene que generar código que compile y Testing tiene que detectar fallos.

Por eso los agentes no usan la API de Claude (de pago). Claude Code se usó para construir el proyecto. La capa de modelos usa el Vercel AI SDK, así que cambiar de proveedor es cambiar una línea y una variable de entorno.

## 2. Cómo evolucionó la decisión

1. **Opciones iniciales:** Gemini (plan gratuito), Groq/OpenRouter (modelos gratuitos) y agentes simulados sin LLM. Descarté los simulados: no serían agentes de IA reales.
2. **NVIDIA como candidato principal.** Antes de aceptarlo comprobé sus condiciones: acceso gratuito del NVIDIA Developer Program para prototipos (producción requiere licencia) y, según reportes de usuarios (no es una cifra oficial), unas 40 peticiones por minuto. Su API es compatible con OpenAI, lo que permite usar un modelo distinto por agente.
3. **Plan provisional:** NVIDIA como principal y Gemini de respaldo, con candidatos Kimi, Mistral Large, GLM y Gemini 2.5 Flash.
4. **Medición antes de fijar nada.** Un benchmark con modelos reales cambió la decisión (siguiente sección).

## 3. Metodología del benchmark

- Misma petición para todos: "Añade una página de contacto a esta web".
- Tres pruebas por modelo, en secuencia, con 3 s de pausa (por debajo del límite de 40 peticiones/min), timeout de 90 s, backoff ante 429 y un reintento ante timeout o 5xx:
  - **Orquestador:** JSON puro con 3-5 tareas `{title, description}` que traten del tema.
  - **Develop:** componente React/TSX de contacto. Se compila con la API de TypeScript (`strict`) y se cuentan 9 checks de accesibilidad y validación (labels asociados, `required`, `aria-*`, `onSubmit`, estado de éxito...).
  - **Testing:** código con dos fallos plantados (off-by-one y `fetch` sin `await`); se mide si el resumen detecta los dos.
- Se midió latencia y tokens de salida. El benchmark lo ejecutó un subagente de Claude Code y se comprobó que ni el script ni el informe contienen claves.

## 4. Resultados (23/11/2026)

| Modelo | Orquestador | Develop (compila / checks) | Testing | Latencia media | Problemas |
|---|---|---|---|---|---|
| `poolside/laguna-xs-2.1` (NVIDIA) | JSON válido, 4 tareas, 2,3 s | Sí / **9 de 9** (~14 s) | 2/2 (1,5 s) | ~6 s | Ninguno |
| `gemini-3.1-flash-lite` | JSON válido, 4 tareas, 2,4 s | Sí / 8 de 9 (~4 s) | 2/2 (2,4 s) | ~3 s | Ninguno |
| `gemini-3.5-flash` | Válido (15 s) en 1 de 2 | No medido | No medido | 15 s | 503 "alta demanda" |
| `mistral-large-4` (NVIDIA) | Válido (75 s) | Timeout x2 | Sí (63 s) | ~69 s | Muy lento |
| `minimax-m3.1-flash` (NVIDIA) | Válido (89 s) | Timeout x2 | Sí (85 s) | ~87 s | Muy lento |
| `kimi-k3.1-pro` (NVIDIA) | Timeout x2 | No medido | No medido | - | Sin respuesta |
| `glm-5.3-flash` (NVIDIA) | Timeout x2 | No medido | No medido | - | Sin respuesta |
| `gemini-2.5-flash` | 404 | - | - | - | No disponible para cuentas nuevas |

Hallazgos:

- Solo dos modelos completaron las tres pruebas: `poolside/laguna-xs-2.1` y `gemini-3.1-flash-lite`.
- En una sonda trivial ("di hola"), Kimi y GLM no respondieron en 70-100 s, mientras Laguna y Nemotron lo hacían en menos de 0,5 s. Parece una cola saturada del plan gratuito de NVIDIA, no un problema de los modelos.
- El catálogo de NVIDIA accesible (32 modelos) solo incluye un modelo de código de chat: `poolside/laguna-xs-2.1`.
- Ningún modelo devolvió 429, así que el límite por minuto no fue el cuello de botella.

## 5. Decisión final

| Rol | Modelo | Motivo |
|---|---|---|
| Orquestador | `gemini-3.1-flash-lite` | JSON estricto en 2,4 s, sin errores y con cuota independiente de NVIDIA |
| Develop | `poolside/laguna-xs-2.1` | Único modelo de código con respuesta fiable; compila y cumple 9/9 |
| Testing | `gemini-3.1-flash-lite` | Detecta los dos fallos en 2,4 s; resumir es barato |

**Respaldo cruzado entre proveedores:** Laguna cubre a Gemini en Orquestador y Testing, y Gemini cubre a Laguna en Develop. Un corte de un proveedor no detiene al equipo. Cada llamada tiene timeout, un reintento con backoff y conmutación automática, y el cambio queda registrado como evento visible en pantalla.

Los modelos que yo esperaba usar (Kimi, GLM, Mistral, Gemini 2.5 Flash) no servían en las condiciones reales. Cambié la decisión porque medí, no por preferencia.

### Revisión tras desplegar en Vercel (23/11/2026)

La tabla anterior es la decisión inicial. Con la app desplegada y la página `/evals` relanzando la evaluación en producción, `gemini-3.1-flash-lite` devolvió HTTP 503 de forma repetida: en dos relanzamientos hubo timeouts y 503, en una ejecución con fallo forzado un 503 hizo que un solo paso tardara 110 s, y en el último relanzamiento las tres pruebas fallaron con 503. Laguna no falló en ninguna ejecución.

Por eso **invertí los papeles**: Laguna es el modelo principal de los tres agentes y Gemini el respaldo. También acorté los timeouts por llamada (de 60 s a 30 s para Orquestador y Testing, y 45 s para Develop, que genera más código) para que el cambio de proveedor sea rápido.

Resultado medido con la misma petición ("Añade una página de contacto a esta web"): antes del cambio, un run con fallo forzado (modo demo, con un intento extra de corrección) tardó 158 s, y un solo paso esperó 110 s por los 503; después, un run sin fallo forzado tardó 39 s con 0 respaldos. **No son ejecuciones equivalentes** (una incluía un intento extra), así que es una señal indicativa y no una comparación exacta.

**Matiz honesto:** Laguna es un modelo pequeño para planificar y los 503 de Gemini son de disponibilidad en ese momento, no de calidad. Si Google se estabiliza, el reparto mixto podría volver a ser mejor. Cambiarlo es una línea en `src/lib/ai/models.ts`.

### Tercer proveedor: Groq (23/11/2026)

**Motivo.** Con Laguna de principal y Gemini como único respaldo, los 503 repetidos de `gemini-3.1-flash-lite` dejaban la cadena **sin respaldo efectivo**: si NVIDIA fallaba, el respaldo también solía fallar. Se añadió Groq (plan gratuito, API compatible con OpenAI) como tercer proveedor.

**Cómo se midió.** `scripts/bench-groq.ts` ejecuta las **mismas tres pruebas y la misma puntuación que la página `/evals`** (`src/lib/evals`: Orquestador con JSON de 3-5 tareas, Develop medido con `runChecks` perfil `contact-form`, Testing con los 2 fallos plantados), llamando a cada modelo **sin respaldo**. Cada prueba se ejecutó **2 veces** por modelo, en secuencia, con 8 s de pausa entre llamadas. Si llega un 429, espera 30 s y repite esa llamada una vez (queda anotado).

| Modelo | Prueba | Ejecución 1 | Ejecución 2 |
|---|---|---|---|
| `openai/gpt-oss-20b` | Orquestador | JSON válido, 4 tareas, 0,7 s | JSON válido, 4 tareas, 0,9 s |
| `openai/gpt-oss-20b` | Develop | Compila, 5/5 checks, 2,1 s | Compila, 5/5 checks, 1,7 s |
| `openai/gpt-oss-20b` | Testing | 2/2 fallos, 1,0 s | 2/2 fallos, 0,8 s |
| `openai/gpt-oss-120b` | Orquestador | JSON válido, 5 tareas, 1,3 s | JSON válido, 5 tareas, 0,8 s |
| `openai/gpt-oss-120b` | Develop | **No compila** (TS2322 en `<style jsx>`), 4/5, 3,8 s | Compila, 5/5 checks, 4,7 s |
| `openai/gpt-oss-120b` | Testing | 2/2 fallos, 1,0 s | 2/2 fallos, 0,7 s |
| `qwen/qwen3.8-27b` | Orquestador | JSON válido, 4 tareas, 1,0 s | JSON válido, 4 tareas, 1,1 s |
| `qwen/qwen3.8-27b` | Develop | Compila, **3/7 checks** (campos sin label, falta «mensaje»), 12,5 s | Compila, 5/5 checks, 8,5 s (tras un 429 y repetir) |
| `qwen/qwen3.8-27b` | Testing | **HTTP 429** también al repetir | 2/2 fallos, 0,9 s |

Resumen: `gpt-oss-20b` 6 de 6 correctas, sin errores, latencia media 1,2 s; `gpt-oss-120b` 5 de 6, latencia media 2,1 s; `qwen3.8-27b` 5 de 6, dos 429 (uno resuelto al repetir), latencia media 3,9 s. El total de checks de Develop varía entre ejecuciones porque `runChecks` añade comprobaciones según lo que encuentra en el código (los 9 checks del informe inicial venían de otro script, `model-bench.mjs`, y no son comparables).

**Elección: `openai/gpt-oss-20b`.** Criterio: fiabilidad primero, después calidad, después latencia. Es el único de los tres sin ningún fallo ni error en las 6 llamadas, sacó 5/5 en Develop las dos veces y además fue el más rápido. `gpt-oss-120b` tuvo un Develop que no compilaba y Qwen chocó con el límite gratuito (429) y entregó una vez un formulario incompleto.

**Cadena resultante en ese momento** (sustituida después, ver la sección siguiente), igual en los tres roles: `laguna-xs-2.1` (primario, intento + 1 reintento si el fallo es transitorio) → `gemini-3.1-flash-lite` (1 intento) → `gpt-oss-20b` en Groq (1 intento). Cada salto se registra como evento («X falla (motivo); uso Y como respaldo»). Si falta la clave de un proveedor, ese eslabón falla al instante y se pasa al siguiente. Se comprobó con un run real del motor dejando vacías las claves de NVIDIA y Google solo en ese proceso: el Orquestador y Develop llegaron a `gpt-oss-20b` y el run terminó aprobado. `gpt-oss-20b` es además el tercer finalista que se relanza desde `/evals` (9 pasos).

**Limitaciones.**

- Muestras pequeñas: 2 ejecuciones por prueba y un solo prompt por agente. Un 6 de 6 frente a un 5 de 6 no es una diferencia estadística; es una señal suficiente para elegir un respaldo, no una clasificación de los modelos.
- Los límites del plan gratuito de Groq (peticiones y tokens por minuto, por modelo) cambian y no son una garantía: Qwen dio 429 incluso con 8 s de pausa, probablemente por el límite de tokens (es el que más tokens genera).
- Los modelos `gpt-oss` razonan antes de responder; con el tope de 4096 tokens de salida no hubo respuestas cortadas en estas pruebas, pero peticiones más grandes podrían acercarse.
- Solo se midió con la petición del formulario de contacto. En la prueba de la cadena forzada, Testing aprobó con los checks deterministas y no llegó a llamar al modelo, así que Groq en el rol de Testing solo está medido por el benchmark.

### Orden actual: `gpt-oss-20b` → Laguna → `gpt-oss-120b` (23/11/2026)

Las pruebas anteriores usaban los prompts simplificados de `/evals`. Después se midió cada candidato con **los prompts reales del motor** (los mismos `INSTRUCTIONS` y el mismo formato de mensaje de `planRun`, `developTask` y `testTask`), 3 repeticiones por prueba y un run completo con cada candidato de principal. Metodología, tablas y limitaciones: [`seguimiento-del-prompt.md`](./seguimiento-del-prompt.md).

Con esos datos se cambió la cadena (`ROLE_MODELS` en `src/lib/ai/models.ts`), igual en los tres roles:

1. **`openai/gpt-oss-20b` (Groq), principal** (intento + 1 reintento si el fallo es transitorio): fue el único sin fallos con los prompts reales y el más rápido.
2. **`poolside/laguna-xs-2.1` (NVIDIA), primer respaldo** (1 intento): es otro proveedor, así que cubre un 429 o una caída de Groq.
3. **`openai/gpt-oss-120b` (Groq), último respaldo** (1 intento): planifica bien, pero en Develop compiló peor y comparte proveedor con el principal.

**Gemini queda fuera de la cadena** mientras siga devolviendo 503 (también lo hizo en la sonda del benchmark de prompts); se sigue midiendo en `/evals`. Con `gpt-oss-20b` de principal, el tope de salida del feedback de Testing pasó de 1.024 a 2.048 tokens, porque una respuesta se cortó por el razonamiento del modelo.

El benchmark también encontró dos fallos de los propios prompts, ya corregidos: el vocabulario de criterios no admitía `svg` ni sus elementos (ahora admite `svg`, `path`, `circle`, `rect`, `g`, `line`, `polyline`, `polygon` y `ellipse`) y el Orquestador nombraba los campos en español (nombre, mensaje) mientras Develop usaba `name`, `email`, `message` (ahora ambos usan los nombres en inglés).

Riesgo principal de este orden: el límite gratuito de Groq por modelo (tokens por minuto) es ajustado para varios runs a la vez; por eso el primer respaldo está en otro proveedor.

## 6. Limitaciones

- **Muestras mínimas:** una ejecución por prueba y un solo prompt por agente; no se midió la variabilidad.
- **Heurísticas:** "sensato" y "detecta los fallos" se evalúan con expresiones regulares y la forma del JSON, sin revisión humana.
- **"Compila" no es "funciona":** solo significa que pasa el chequeo de tipos. No se ejecutó en un navegador ni con lector de pantalla.
- **Calidad sin medir** de Kimi, GLM, Mistral y MiniMax por los timeouts. Convendría repetir en otro horario.
- **Dependencia de planes gratuitos:** pueden cambiar (ya ocurrió con `gemini-2.5-flash`), devolver 503 o congestionarse. Mitigación: cadena de respaldo con dos proveedores en uso (Groq y NVIDIA; Google se mide en `/evals` pero está fuera de la cadena por los 503), límite de iteraciones y modelos configurables en un solo archivo.
- **Términos:** el acceso gratuito de NVIDIA es para prototipos; producción requeriría licencia.
- **Costes y cuotas de producción:** no medidos.

## 7. Cómo reproducirlo

```bash
node scripts/model-bench.mjs
node scripts/model-bench.mjs --only=poolside/laguna-xs-2.1,gemini-3.1-flash-lite
```

Requiere `NVIDIA_API_KEY` y `GOOGLE_GENERATIVE_AI_API_KEY` en `.env.local` (ver `.env.example`).

Benchmark de los candidatos de Groq (mismas pruebas que `/evals`, requiere `GROQ_API_KEY`):

```bash
npx tsx scripts/bench-groq.ts                 # 2 ejecuciones por prueba, 8 s de pausa
npx tsx scripts/bench-groq.ts --reps=3 --pause=10 --only=openai/gpt-oss-20b
```
