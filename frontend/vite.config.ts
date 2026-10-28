import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offlineBuild } from "./offline-build";
export default defineConfig({
  plugins: [react(), offlineBuild()],
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shared imports must never point back at the entry that installs the RPC
          // message listener. WebKit can evaluate a worker entry again on import.
          if (
            /\/src\/(storage|engine|validation|i18n-core|template-state|casefold)\.ts$/.test(
              id,
            ) ||
            id.includes("/shared/locales/")
          )
            return "worker-runtime";
        },
      },
    },
  },
  preview: {
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'none'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    },
  },
});
