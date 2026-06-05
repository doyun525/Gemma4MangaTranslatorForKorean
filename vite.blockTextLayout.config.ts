import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/shared/blockTextLayout.browser.entry.ts",
      formats: ["iife"],
      name: "MgtBlockTextLayoutBundle",
      fileName: () => "blockTextLayout.browser.js"
    },
    outDir: "out/shared",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        extend: true
      }
    }
  }
});
