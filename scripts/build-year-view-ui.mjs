import { build } from "esbuild";

await build({
  entryPoints: ["src/ui/year-view/ts/main.tsx"],
  outfile: "src/ui/year-view/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: false,
  minify: false,
  jsx: "automatic"
});

console.log("Built src/ui/year-view/app.js");
