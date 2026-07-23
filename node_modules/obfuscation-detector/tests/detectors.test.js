import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import {detectObfuscation, detectObfuscationDetailed, detectObfuscationReduced} from '../src/index.js';
import {detectors, validateDetectors} from '../src/detectors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFolder = path.join(__dirname, 'resources');

const fixtures = [
  {
    filename: 'array_function_replacements_local_proxies.js',
    raw: ['array_function_replacements'],
    reduced: ['array_function_replacements'],
  },
  {
    filename: 'array_replacements.js',
    raw: ['array_replacements'],
    reduced: ['array_replacements'],
  },
  {
    filename: 'array_replacements_prototype_calls.js',
    raw: ['array_replacements'],
    reduced: ['array_replacements'],
  },
  {
    filename: 'augmented_array_function_replacements.js',
    raw: ['array_function_replacements', 'augmented_array_function_replacements'],
    reduced: ['augmented_array_function_replacements'],
  },
  {
    filename: 'augmented_proxied_array_function_replacements.js',
    raw: ['augmented_proxied_array_function_replacements', 'function_to_array_replacements'],
    reduced: ['augmented_proxied_array_function_replacements', 'function_to_array_replacements'],
  },
  {
    filename: 'caesar_plus.js',
    raw: ['caesar_plus'],
    reduced: ['caesar_plus'],
  },
  {
    filename: 'obfuscator.io-NotBooleanTilde.js',
    raw: ['obfuscator_io'],
    reduced: ['obfuscator_io'],
  },
  {
    filename: 'obfuscator.io-setCookie.js',
    raw: ['array_function_replacements', 'augmented_array_function_replacements', 'obfuscator_io'],
    reduced: ['obfuscator_io'],
  },
];

function readFixture(filename) {
  return fs.readFileSync(path.join(targetFolder, filename), 'utf-8');
}

describe('Detectors', () => {
  fixtures.forEach(({filename, raw, reduced}) => {
    it(`detects ${filename} in raw mode`, () => {
      assert.deepStrictEqual(detectObfuscation(readFixture(filename)), raw);
    });

    it(`detects ${filename} in reduced mode`, () => {
      assert.deepStrictEqual(detectObfuscationReduced(readFixture(filename)), reduced);
    });

    it(`reports deterministic detailed results for ${filename}`, () => {
      const detailed = detectObfuscationDetailed(readFixture(filename));
      assert.deepStrictEqual(detailed.map(result => result.name), raw);
      detailed.forEach(result => {
        assert.ok(Array.isArray(result.prioritizeOver));
        assert.ok(Array.isArray(result.suppressedBy));
      });
    });
  });
});

describe('Priority graph', () => {
  it('contains only valid prioritizeOver targets', () => {
    assert.doesNotThrow(() => validateDetectors());
  });

  it('reduces detections independently of detector declaration order', async () => {
    const reversedDetectorNames = [...detectors].reverse().map(detector => detector.name);
    const code = readFixture('augmented_proxied_array_function_replacements.js');

    const baseline = detectObfuscationReduced(code);
    const {generateFlatAST} = await import('flast');
    const tree = generateFlatAST(code);
    const detectedNames = [];
    const reversedMap = new Map(detectors.map(detector => [detector.name, detector]));

    for (const detectorName of reversedDetectorNames) {
      const detector = reversedMap.get(detectorName);
      if (detector.detect(tree, detectedNames)) detectedNames.push(detector.name);
    }

    const suppressed = new Set();
    function suppressFrom(detectorName) {
      const detector = reversedMap.get(detectorName);
      detector.prioritizeOver.forEach(prioritizedName => {
        if (!suppressed.has(prioritizedName)) {
          suppressed.add(prioritizedName);
          suppressFrom(prioritizedName);
        }
      });
    }

    detectedNames.forEach(suppressFrom);
    const reduced = detectedNames.filter(name => !suppressed.has(name));

    assert.deepStrictEqual(reduced.sort(), baseline.slice().sort());
  });

  it('reports which detections were suppressed by more inclusive matches', () => {
    const detailed = detectObfuscationDetailed(readFixture('augmented_proxied_array_function_replacements.js'));
    assert.deepStrictEqual(detailed, [
      {
        name: 'augmented_proxied_array_function_replacements',
        prioritizeOver: ['array_function_replacements', 'augmented_array_function_replacements'],
        suppressedBy: [],
      },
      {
        name: 'function_to_array_replacements',
        prioritizeOver: [],
        suppressedBy: [],
      },
    ]);
  });
});
