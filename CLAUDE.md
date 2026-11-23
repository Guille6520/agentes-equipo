# Equipo de agentes (Orquestador, Develop, Testing)

Prueba técnica: tres agentes de IA que colaboran. El Orquestador divide una petición en tareas, Develop las implementa y Testing las comprueba, devolviendo los fallos a Develop hasta que todo pasa.

## Stack
- Next.js (App Router) + TypeScript + Tailwind, desplegado en Vercel.
- Neon (Postgres) con Drizzle ORM. Esquema en `src/db/schema.ts`.
- Vercel AI SDK, con un modelo por agente y respaldo cruzado entre proveedores (ver `docs/model-comparison.md`):
  Orquestador y Testing con `gemini-3.1-flash-lite`; Develop con `poolside/laguna-xs-2.1` (NVIDIA, API compatible con OpenAI).
  Si un proveedor falla, el otro cubre.
- Orquestación: máquina de estados propia; tareas y estados persistidos en BD.
- UI en vivo: tablero de tareas + estado de cada agente + log de eventos, con polling.

## Convenciones
- Interfaz y README en español; código, nombres e identificadores en inglés.
- Nunca commitear claves. Variables en `.env.local` (ver `.env.example`) y en Vercel.
- Cada agente tiene un límite de iteraciones para no bucle infinito ni agotar cuota.
- Testing usa checks deterministas y sandbox; el LLM solo resume fallos.

## Comandos
- `npm run dev` · `npm run build` · `npm run lint`
- `npx drizzle-kit push` aplica el esquema a Neon.
