import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;
const coreUiRoot = resolve(repositoryRoot, "src/core/ui");

export default defineConfig({
    root: resolve(repositoryRoot, "src/hosts/saas"),
    envDir: repositoryRoot,
    base: "/",
    publicDir: false,
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": coreUiRoot
        },
        dedupe: ["react", "react-dom"]
    },
    build: {
        emptyOutDir: true,
        outDir: resolve(repositoryRoot, "dist/saas")
    }
});