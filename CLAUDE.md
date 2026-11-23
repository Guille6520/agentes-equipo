# Equipo de agentes (Orquestador, Develop, Testing)

Prueba técnica: tres agentes de IA que colaboran. El Orquestador divide una petición en tareas, Develop las implementa y Testing las comprueba, devolviendo los fallos a Develop hasta que todo pasa.

## Stack
- Next.js (App Router) + TypeScript + Tailwind, desplegado en Vercel.
- Neon (Postgres) con Drizzle ORM. Esquema en `src/db/schema.ts`.
- Vercel AI SDK, con una cadena de respaldo entre proveedores (ver `docs/seleccion-de-modelos.md` y
  `docs/seguimiento-del-prompt.md`): los tres agentes usan `openai/gpt-oss-20b` (Groq) como principal y, en orden,
  `poolside/laguna-xs-2.1` (NVIDIA) y `openai/gpt-oss-120b` (Groq) como respaldos (`ROLE_MODELS` en
  `src/lib/ai/models.ts`). El orden sale del benchmark con los prompts reales del motor; Gemini queda fuera de la
  cadena mientras devuelva 503 (se sigue midiendo en `/evals`). Timeout por llamada: 30 s (Orquestador, Testing) y
  45 s (Develop); el primario tiene un reintento y cada respaldo un intento.
- Orquestación: máquina de estados propia; tareas y estados persistidos en BD.
- UI en vivo: tablero de tareas + estado de cada agente + log de eventos, con polling.

## Convenciones
- Interfaz y README en español; código, nombres e identificadores en inglés.
- Nunca commitear claves. Variables en `.env.local` (ver `.env.example`) y en Vercel.
- Cada agente tiene un límite de iteraciones para no bucle infinito ni agotar cuota.
- Testing usa checks deterministas y sandbox; el LLM solo resume fallos. Además verifica los criterios
  de aceptación que el Orquestador define para cada tarea.
- El render de Testing se ejecuta en un proceso hijo aislado (`src/lib/testing/sandbox/render-child.cjs`: `env: {}`,
  modelo de permisos de Node, sin generación de código desde cadenas). No pases objetos ni variables del servidor al
  hijo. Todo texto que salga al exterior (eventos, feedback, errores de API) pasa por `redact()` de
  `src/lib/security/redact.ts`. Contenido del usuario en prompts: siempre con `dataBlock()` de `engine/shared.ts`.
- La base de datos la comparte producción: los cambios de esquema deben ser aditivos.
- Las rutas que ejecutan Testing o la vista previa necesitan `outputFileTracingIncludes` en `next.config.ts`
  (incluido el script del proceso hijo del render).

## Comandos
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
- `npx tsx src/lib/testing/run-fixtures.ts` prueba los checks de Testing.
- `npx tsx scripts/e2e-engine.ts "<petición>" [--demo-failure]` ejecuta el motor con modelos reales.
- `npx tsx scripts/bench-groq.ts` mide los candidatos de Groq con las pruebas de `/evals` (sin respaldo).
- `npx drizzle-kit push` aplica el esquema a Neon.
- `/verify` (en `.claude/commands/`) ejecuta toda la verificación; el subagente `code-reviewer` revisa entregas.
