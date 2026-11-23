import type { NextConfig } from "next";

// Testing compila y renderiza el código generado en tiempo de ejecución, así que el
// bundle serverless debe incluir las librerías de TypeScript, los tipos de React,
// react/react-dom y el script del proceso hijo que hace el render aislado
// (src/lib/testing/sandbox/render-child.cjs, se lanza con `node`, no se importa), que el
// trazado automático de archivos no detecta.
const testingRuntimeFiles = [
  "./src/lib/testing/sandbox/render-child.cjs",
  "./node_modules/typescript/lib/lib.*.d.ts",
  "./node_modules/@types/react/**",
  "./node_modules/csstype/**",
  "./node_modules/react/**",
  "./node_modules/react-dom/**",
  "./node_modules/scheduler/**",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/runs": testingRuntimeFiles,
    "/api/runs/[id]/advance": testingRuntimeFiles,
    "/api/evals": testingRuntimeFiles,
    // El paso de /evals puntúa Develop con runChecks (render incluido).
    "/api/evals/[id]/step": testingRuntimeFiles,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
