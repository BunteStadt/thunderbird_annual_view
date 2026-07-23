#!/usr/bin/env node
// Belongs here: the thin process entry point - call cli.main(argv), then exit
// with its code (and exit 2 on a thrown failure).
//
// Does NOT belong here: argv parsing, validation, and report routing (those
// live in cli.js main). The schema review itself lives in pipeline.js
// runPipeline.
import { main } from "./src/cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err?.stack || String(err));
    process.exit(2);
  }
);
