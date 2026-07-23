#!/usr/bin/env node
import fs from 'node:fs';
import {detectObfuscation, detectObfuscationDetailed, detectObfuscationReduced} from './../src/index.js';

function printUsage() {
  console.log('Usage: obfuscation-detector /path/to/obfuscated.js [--reduced|-r] [--json|-j] [--detailed|-d]');
  console.log('       obfuscation-detector < file.js [--reduced|-r] [--json|-j] [--detailed|-d]');
  console.log('       obfuscation-detector --help|-h');
}

function formatDetailedResults(results) {
  return results.map(result => {
    const prioritizeOver = result.prioritizeOver.length ? result.prioritizeOver.join(', ') : '(none)';
    const suppressedBy = result.suppressedBy.length ? result.suppressedBy.join(', ') : '(none)';

    return [
      `[+] ${result.name}`,
      `    prioritizeOver: ${prioritizeOver}`,
      `    suppressedBy: ${suppressedBy}`,
    ].join('\n');
  }).join('\n');
}

const args = process.argv.slice(2);
const allowedFlags = new Set(['--help', '-h', '--reduced', '-r', '--json', '-j', '--detailed', '-d']);

// Check for unknown flags
const unknownFlags = args.filter(arg => arg.startsWith('-') && !allowedFlags.has(arg));
if (unknownFlags.length) {
  console.error(`[-] Unknown flag(s): ${unknownFlags.join(', ')}`);
  printUsage();
  process.exit(1);
}

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

try {
  let content = '';
  const useReduced = args.includes('--reduced') || args.includes('-r');
  const useJson = args.includes('--json') || args.includes('-j');
  const useDetailed = args.includes('--detailed') || args.includes('-d');

  // Remove flags from file argument
  const fileArg = args.find(arg => !arg.startsWith('-'));

  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.error(`[-] File not found: ${fileArg}`);
      printUsage();
      process.exit(1);
    }
    content = fs.readFileSync(fileArg, 'utf-8');
  } else if (!process.stdin.isTTY) {
    content = fs.readFileSync(0, 'utf-8');
  } else {
    printUsage();
    process.exit(1);
  }

  const results = useDetailed
    ? detectObfuscationDetailed(content)
    : useReduced
      ? detectObfuscationReduced(content)
      : detectObfuscation(content);

  if (useJson) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length) {
    if (useDetailed) console.log(formatDetailedResults(results));
    else console.log('[+] ' + results.join(', '));
  } else {
    console.log('[-] No obfuscation detected / unknown obfuscation');
  }
} catch (e) {
  console.error(`[X] Critical Error: ${e.message}`);
  process.exit(1);
}
