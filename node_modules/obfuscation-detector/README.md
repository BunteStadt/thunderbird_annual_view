# Obfuscation Detector
[![Node.js CI](https://github.com/ctrl-escp/obfuscation-detector/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/ctrl-escp/obfuscation-detector/actions/workflows/node.js.yml)
[![Downloads](https://img.shields.io/npm/dm/obfuscation-detector.svg?maxAge=43200)](https://www.npmjs.com/package/obfuscation-detector)

## Overview
Obfuscation Detector is a tool for identifying different types of JavaScript obfuscation by analyzing the code's Abstract Syntax Tree (AST). It is designed for security researchers, reverse engineers, and developers who need to quickly determine if and how a JavaScript file has been obfuscated.

For comments and suggestions feel free to open an issue or find me on [LinkedIn](https://www.linkedin.com/in/bbaryo/)

## How it Works
Obfuscation Detector parses JavaScript code into an AST using [flAST](https://www.npmjs.com/package/flast) and applies a series of modular detectors. Each detector reports a binary true/false result and can explicitly declare which less-inclusive detections it should suppress in reduced output.

## Installation
```shell
npm install obfuscation-detector
```

## Usage
### As a Module
```javascript
import fs from 'node:fs';
import {
  detectObfuscation,
  detectObfuscationDetailed,
  detectObfuscationReduced,
} from 'obfuscation-detector';

const code = fs.readFileSync('obfuscated.js', 'utf-8');
const rawMatches = detectObfuscation(code);
const reducedMatches = detectObfuscationReduced(code);
const detailedMatches = detectObfuscationDetailed(code);

console.log(`Raw detections: ${rawMatches.join(', ')}`);
console.log(`Reduced detections: ${reducedMatches.join(', ')}`);
console.log(detailedMatches);
```

### CLI
```shell
obfuscation-detector /path/to/obfuscated.js [--reduced|-r] [--detailed|-d] [--json|-j]
cat /path/to/obfuscated.js | obfuscation-detector [--reduced|-r] [--detailed|-d] [--json|-j]
obfuscation-detector --help
```

#### CLI Options
- `--reduced`, `-r`: Return only detections that are not prioritized over by another detected type.
- `--detailed`, `-d`: Return detections with `prioritizeOver` and `suppressedBy` metadata.
- `--json`, `-j`: Print the selected output mode as JSON.
- `--help`, `-h`: Show usage instructions.
- Unknown flags will result in an error and print the usage.

#### Examples
- **Raw detections:**
  ```shell
  $ obfuscation-detector /path/to/obfuscated.js
  [+] function_to_array_replacements, augmented_proxied_array_function_replacements
  ```
- **Reduced detections:**
  ```shell
  $ obfuscation-detector /path/to/obfuscated.js --reduced
  [+] augmented_proxied_array_function_replacements
  ```
- **Detailed text output:**
  ```shell
  $ obfuscation-detector /path/to/obfuscated.js --detailed
  [+] augmented_array_function_replacements
      prioritizeOver: array_function_replacements
      suppressedBy: (none)
  ```
- **Detailed JSON output:**
  ```shell
  $ cat obfuscated.js | obfuscation-detector --detailed --json
  [
    {
      "name": "augmented_array_function_replacements",
      "prioritizeOver": ["array_function_replacements"],
      "suppressedBy": []
    }
  ]
  ```

## API Reference
### `detectObfuscation(code: string): string[]`
- **code**: JavaScript source code as a string.
- **Returns**: All detected obfuscation type names.

### `detectObfuscationReduced(code: string): string[]`
- **code**: JavaScript source code as a string.
- **Returns**: Only detections that are not suppressed by another detected type's `prioritizeOver` graph.

### `detectObfuscationDetailed(code: string): DetectionResult[]`
- **code**: JavaScript source code as a string.
- **Returns**: Detection results with deterministic priority metadata.

### `DetectionResult`
- `name: string`
- `prioritizeOver: string[]`
- `suppressedBy: string[]`

## Priority Semantics
- `prioritizeOver` expresses structural inclusiveness, not confidence or likelihood.
- Raw output returns every true detection.
- Reduced output suppresses any detection dominated by another true detection.
- Example: `augmented_array_replacements` can prioritize over `array_replacements`, because the augmented pattern includes the array-replacement pattern.

## Supported Obfuscation Types
Descriptions and technical details for each type are available in [src/detectors/README.md](src/detectors/README.md):
- [Array Replacements](src/detectors/arrayReplacements.js)
- [Augmented Array Replacements](src/detectors/augmentedArrayReplacements.js)
- [Array Function Replacements](src/detectors/arrayFunctionReplacements.js)
- [Augmented Array Function Replacements](src/detectors/augmentedArrayFunctionReplacements.js)
- [Function To Array Replacements](src/detectors/functionToArrayReplacements.js)
- [Obfuscator.io](src/detectors/obfuscatorIo.js)
- [Caesar Plus](src/detectors/caesarPlus.js)

## Troubleshooting
- **No obfuscation detected:** The code may not be obfuscated, or it uses an unknown technique. Consider contributing a new detector!
- **Error: File not found:** Check the file path and try again.
- **Unknown flag:** Run with only `--help` to see what options are available.
- **Performance issues:** For very large files, detection may take longer because all detectors are evaluated for raw classification.

## Contribution
To contribute to this project, see our [contribution guide](CONTRIBUTING.md).

---
For technical details on each obfuscation type and how to add new detectors, see [src/detectors/README.md](src/detectors/README.md).
