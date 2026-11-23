# Comparativa de modelos para los 3 agentes

Fecha de la prueba: 2026-11-23. Script reproducible: `node scripts/model-bench.mjs` (opcional `--only=id1,id2`).

## Metodología

Cada modelo recibe, en secuencia y con 3 s de pausa entre llamadas (por debajo del límite gratuito de NVIDIA, ~40 peticiones/min), tres pruebas. Timeout de 90 s por llamada; ante 429 se reintenta con backoff exponencial y ante timeout/5xx se reintenta una vez.

- **Orquestador**: "Añade una página de contacto a esta web" -> JSON con 3-5 tareas `{title, description}`. Se comprueba que el JSON se parsea sin texto extra, que hay 3-5 tareas con título y descripción, y que tratan del tema (formulario/contacto/email).
- **Develop**: página de contacto en un único componente React/TSX. Se compila con la API de TypeScript (`strict`, `jsx: react-jsx`) y se cuentan 9 checks: labels asociados a los 3 campos, `required`, `aria-invalid`, `aria-describedby`, región `role=alert/status`/`aria-live`, `onSubmit`, `preventDefault`, validación de email y estado de éxito.
- **Testing**: código con 2 fallos plantados (índice de página off-by-one y `fetch` sin `await`) más la salida de los tests; se pide un resumen. La detección se mide con expresiones regulares sobre la respuesta (heurística, ver limitaciones).

Cada prueba se ejecutó una vez, con un reintento ante fallo transitorio. Los modelos que no respondieron en el Orquestador (timeout tras reintento) se repitieron en una segunda ejecución y se omitió el resto de sus pruebas.

## Resultados

| Modelo | Proveedor | Orquestador (JSON válido / sensato) | Develop: compila | Develop: checks | Testing: detecta 2/2 | Latencia media | Errores |
|---|---|---|---|---|---|---|---|
| poolside/laguna-xs-2.1 | NVIDIA | Sí / Sí (4 tareas, 2,3 s) | Sí | 9/9 | Sí (1,5 s) | ~6 s | Ninguno |
| gemini-3.1-flash-lite | Google | Sí / Sí (4 tareas, 2,4 s) | Sí | 8/9 | Sí (2,4 s) | ~3 s | Ninguno |
| gemini-3.5-flash | Google | Sí / Sí (4 tareas, 15 s) en una ejecución; 503 en la otra | No medido | No medido | No medido | 15 s | 503 "high demand" repetidos |
| mistralai/mistral-large-4-1t-a52b | NVIDIA | Sí / Sí (75 s) | No medido (timeout 90 s x2) | - | Sí (63 s) | ~69 s | Timeouts (orquestador en la 1.ª ejecución, Develop en ambas) |
| minimaxai/minimax-m3.1-flash | NVIDIA | Sí / Sí (89 s) | No medido (timeout x2) | - | Sí (85 s) | ~87 s | Timeouts |
| moonshotai/kimi-k3.1-pro | NVIDIA | Timeout 90 s (x2 ejecuciones) | No medido | - | No medido | - | Sin respuesta |
| z-ai/glm-5.3-flash | NVIDIA | Timeout 90 s (x2 ejecuciones) | No medido | - | No medido | - | Sin respuesta |
| gemini-2.5-flash | Google | 404 | - | - | - | - | "no longer available to new users" con esta clave |

Notas: el catálogo de NVIDIA con esta clave tiene 32 modelos; el único orientado a código aparte de `bigcode/starcoder2-15b` (no es de chat) es `poolside/laguna-xs-2.1`. No hay qwen-coder ni deepseek disponibles. Ningún modelo devolvió 429. Tokens de salida en Develop: laguna 1128, gemini-3.1-flash-lite 1034.

## Conclusiones

- Los dos únicos modelos que completaron las 3 pruebas fueron `poolside/laguna-xs-2.1` y `gemini-3.1-flash-lite`: ambos con JSON válido, código que compila y ambos fallos detectados, con latencias de pocos segundos.
- Laguna obtuvo 9/9 checks de accesibilidad/validación frente a 8/9 de Gemini Flash-Lite (le faltó uno de los checks).
- Los modelos grandes de NVIDIA (Kimi, Mistral Large, GLM, MiniMax) se comportaron como colas saturadas en el plan gratuito: respuestas de 60-90 s o timeouts, incluso con prompts triviales (en una sonda de "di hola", GLM y Kimi no respondieron en 70-100 s mientras Laguna y Nemotron respondían en menos de 0,5 s). Cuando respondieron (Mistral y MiniMax en Orquestador y Testing), la calidad fue correcta, pero la latencia los hace inviables para un flujo interactivo sin más garantías.
- `gemini-3.5-flash` es capaz (JSON válido en 15 s) pero sufrió 503 por alta demanda; no es fiable ahora mismo.

## Recomendación

| Rol | Modelo | Motivo |
|---|---|---|
| Orquestador | `gemini-3.1-flash-lite` | JSON estricto y sensato en 2,4 s, sin errores, cuota propia independiente de NVIDIA. |
| Develop | `poolside/laguna-xs-2.1` | Único modelo de código disponible, compila y cumple 9/9 checks; latencia ~14 s para ~1100 tokens. |
| Testing | `gemini-3.1-flash-lite` | Detectó ambos fallos en 2,4 s; el resumen es barato y rápido. |
| Respaldo | `poolside/laguna-xs-2.1` para Orquestador/Testing; `gemini-3.1-flash-lite` para Develop | Cada uno cubre al otro: son proveedores distintos, así un corte de NVIDIA o de Google no para el equipo. |

Implementación sugerida: timeout de 30-45 s por llamada, un reintento con backoff y conmutación automática al modelo de respaldo.

## Limitaciones (qué no se pudo verificar)

- Muestras mínimas: 1 ejecución por prueba, con un único prompt por agente; la variabilidad entre ejecuciones no está medida.
- La detección de fallos y el carácter "sensato" de las tareas usan heurísticas (regex y forma del JSON), no una revisión humana de la calidad del texto.
- "Compila" significa que pasa el chequeo de tipos de TypeScript; no se ejecutó el componente en un navegador ni se probó con lector de pantalla.
- Kimi k3.1 pro y GLM 5.3 flash no respondieron en ninguna ejecución, y Mistral Large y MiniMax no completaron Develop; su calidad de código sigue sin medirse. Podría deberse a congestión puntual del plan gratuito y no a los modelos; conviene repetir en otro horario.
- `gemini-2.5-flash` no pudo probarse (404 para esta clave); se sustituyó por `gemini-3.5-flash` y `gemini-3.1-flash-lite`.
- No se midieron costes ni límites exactos de cuota de producción.
