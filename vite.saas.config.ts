import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;

export default defineConfig({
    root: resolve(repositoryRoot, "src/hosts/saas"),
    base: "/",
    publicDir: false,
    plugins: [react(), tailwindcss()],
    build: {
        emptyOutDir: true,
        outDir: resolve(repositoryRoot, "dist/saas")
    }
});