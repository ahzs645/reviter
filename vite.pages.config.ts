import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const base = process.env.PAGES_BASE_PATH ?? "/";

export default defineConfig({
  root: "github-pages",
  base,
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
