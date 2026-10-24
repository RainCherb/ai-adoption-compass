import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const API_TARGET = "http://127.0.0.1:8000";

// Собранный фронтенд кладётся прямо в пакет бэкенда: его раздаёт FastAPI
// (см. adoption_compass.api.app._mount_frontend), поэтому внешние запросы не нужны.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../src/adoption_compass/static",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": API_TARGET },
  },
  preview: {
    proxy: { "/api": API_TARGET },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    env: { TZ: "UTC" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/api/schema.d.ts", "src/api/types.ts", "src/vite-env.d.ts", "src/main.tsx"],
      reporter: ["text-summary", "text"],
    },
  },
});
