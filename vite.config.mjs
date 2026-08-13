import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;
const uiRoot = resolve(repositoryRoot, "src/core/ui");

export default defineConfig(() => {
    return {
        root: uiRoot,
        base: "./",
        publicDir: false,
        plugins: [react(), tailwindcss()],
        resolve: {
            alias: {
                "@calendar-host": resolve(repositoryRoot, "src/hosts/thunderbird/main.js")
            }
        },
        build: {
            emptyOutDir: true,
            outDir: resolve(repositoryRoot, "dist/package"),
            minify: false,
            rollupOptions: {
                input: {
                    index: resolve(uiRoot, "index.html")
                },
                output: {
                    entryFileNames: "assets/[name].js",
                    chunkFileNames: "assets/[name]-[hash].js",
                    assetFileNames: "assets/[name]-[hash][extname]"
                }
            }
        }
    };
});