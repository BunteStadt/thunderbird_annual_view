import { resolve } from "node:path";
import { defineConfig } from "vite";

const repositoryRoot = import.meta.dirname;
const uiRoot = resolve(repositoryRoot, "src/core/ui");

export default defineConfig(({ mode }) => {
    const thunderbird = mode === "thunderbird";

    return {
        root: uiRoot,
        base: "./",
        publicDir: false,
        resolve: {
            alias: {
                "@calendar-host": resolve(repositoryRoot, thunderbird ? "src/hosts/thunderbird/main.js" : "src/hosts/web/main.js")
            }
        },
        build: {
            emptyOutDir: true,
            outDir: resolve(repositoryRoot, thunderbird ? "dist/package" : "dist/web"),
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