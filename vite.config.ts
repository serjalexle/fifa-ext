import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    build: {
      outDir: "dist",
      sourcemap: true,
      emptyOutDir: !isDev, // ✅ у dev НЕ чистимо dist
      rollupOptions: {
        input: {
          bridgeBoot: resolve(__dirname, "src/content/bridgeBoot.ts"),
          content: resolve(__dirname, "src/content/index.ts"),
          transferMarketBridge: resolve(__dirname, "src/injected/transferMarketBridge.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  };
});
