import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5273,
    proxy: {
      // inoltra le chiamate API e l'avvio OAuth al backend Express
      "/api": "http://localhost:4000",
      "/auth": "http://localhost:4000",
    },
  },
});
