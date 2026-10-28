import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offlineBuild } from "./offline-build";
export default defineConfig({
  plugins: [react(), offlineBuild()],
  preview: {
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'none'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    },
  },
});
