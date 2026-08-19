import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;
const uiRoot = resolve(repositoryRoot, "src/core/ui");

export default defineConfig({
    root: uiRoot,
    base: "/",
    publicDir: false,
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": uiRoot,
            "@calendar-host": resolve(repositoryRoot, "src/hosts/core/main.js")
        }
    },
    build: {
        emptyOutDir: true,
        outDir: resolve(repositoryRoot, "dist/core")
    }
});
