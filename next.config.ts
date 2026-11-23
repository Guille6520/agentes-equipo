import type { NextConfig } from "next";

// Testing compila y renderiza el código generado en tiempo de ejecución, así que el
// bundle serverless debe incluir las librerías de TypeScript, los tipos de React y
// react/react-dom, que el trazado automático de archivos no detecta.
const testingRuntimeFiles = [
  "./node_modules/typescript/lib/lib.*.d.ts",
  "./node_modules/@types/react/**",
  "./node_modules/csstype/**",
  "./node_modules/react/**",
  "./node_modules/react-dom/**",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/runs": testingRuntimeFiles,
    "/api/runs/[id]/advance": testingRuntimeFiles,
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
