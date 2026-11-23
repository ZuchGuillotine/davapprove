import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8000" } },
  // Existing suites exercise the project workflow; beta (flag off) behaviour is tested with vi.stubEnv.
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", css: false, env: { VITE_FEATURE_PROJECTS: "true" } },
});
