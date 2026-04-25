import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/envSetup.ts"],
    globalSetup: ["tests/integration/globalSetup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Los tests de integración comparten Postgres + Redis. Ejecutar
    // archivos en paralelo causa colisiones de cleanup (un test borra
    // filas que otro acaba de insertar). Forzar serial es lo más
    // simple y la lentitud es despreciable en este tamaño de suite.
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
