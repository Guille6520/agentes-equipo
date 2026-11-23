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

## 6. Limitaciones

- **Muestras mínimas:** una ejecución por prueba y un solo prompt por agente; no se midió la variabilidad.
- **Heurísticas:** "sensato" y "detecta los fallos" se evalúan con expresiones regulares y la forma del JSON, sin revisión humana.
- **"Compila" no es "funciona":** solo significa que pasa el chequeo de tipos. No se ejecutó en un navegador ni con lector de pantalla.
- **Calidad sin medir** de Kimi, GLM, Mistral y MiniMax por los timeouts. Convendría repetir en otro horario.
- **Dependencia de planes gratuitos:** pueden cambiar (ya ocurrió con `gemini-2.5-flash`), devolver 503 o congestionarse. Mitigación: respaldo cruzado, límite de iteraciones y modelos configurables en un solo archivo.
- **Términos:** el acceso gratuito de NVIDIA es para prototipos; producción requeriría licencia.
- **Costes y cuotas de producción:** no medidos.

## 7. Cómo reproducirlo

```bash
node scripts/model-bench.mjs
node scripts/model-bench.mjs --only=poolside/laguna-xs-2.1,gemini-3.1-flash-lite
```

Requiere `NVIDIA_API_KEY` y `GOOGLE_GENERATIVE_AI_API_KEY` en `.env.local` (ver `.env.example`).
