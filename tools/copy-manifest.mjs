import { mkdirSync, copyFileSync, cpSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("popup.html", "dist/popup.html");
cpSync("styles", "dist/styles", { recursive: true });
cpSync("src/icons", "dist/icons", { recursive: true });

