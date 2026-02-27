import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    build: {
      outDir: "dist",
      sourcemap: true,
      emptyOutDir: !isDev, // Keep dist in dev watch mode.
      rollupOptions: {
        input: {
          content: resolve(__dirname, "src/content/index.ts"),
          sbcBridge: resolve(__dirname, "src/injected/sbcBridge.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  };
});
