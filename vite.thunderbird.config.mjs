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
        define: {
            "process.env.NODE_ENV": JSON.stringify("development")
        },
        resolve: {
            alias: {
                "@": uiRoot,
                "@calendar-host": resolve(repositoryRoot, "src/hosts/thunderbird/main.js")
            }
        },
        build: {
            emptyOutDir: true,
            outDir: resolve(repositoryRoot, "dist/package"),
            modulePreload: {
                polyfill: false
            },
            minify: false,
            rollupOptions: {
                input: {
                    index: resolve(uiRoot, "index.html")
                },
                output: {
                    preserveModules: true,
                    preserveModulesRoot: repositoryRoot,
                    entryFileNames: "assets/[name].js",
                    chunkFileNames: "assets/[name]-[hash].js",
                    assetFileNames: "assets/[name]-[hash][extname]"
                }
            }
        }
    };
});