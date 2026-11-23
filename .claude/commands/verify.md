---
description: Verifica el proyecto entero antes de commitear (tipos, lint, tests, checks de Testing y build)
---

Ejecuta, en este orden, y detente en el primer fallo explicando la causa:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npx tsx src/lib/testing/run-fixtures.ts`
5. `npm run build`

Después del build, comprueba que las rutas que ejecutan Testing incluyen en su bundle las librerías
de TypeScript y React: busca `lib.*.d.ts` y `@types/react` en los `route.js.nft.json` de
`.next/server/app/api/runs/**` y `.next/server/app/api/evals/**`. Si faltan, Testing fallará en Vercel
aunque todo pase en local (ver `outputFileTracingIncludes` en `next.config.ts`).

Antes de dar por bueno un commit, busca secretos en los archivos preparados:
`git diff --cached | grep -nE "nvapi-|AIza|postgres(ql)?://[^ ]+:[^@ ]+@|sk-[A-Za-z0-9]{20,}"`.

Resume el resultado en una tabla: comando, resultado y, si falla, el primer error.
No modifiques código para que algo pase sin decirlo explícitamente.
