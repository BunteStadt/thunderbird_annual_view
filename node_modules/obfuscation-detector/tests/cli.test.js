import assert from 'node:assert';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const cliPath = path.join(projectRoot, 'bin', 'obfuscation-detector.js');
const fixturePath = path.join(__dirname, 'resources', 'obfuscator.io-setCookie.js');

describe('CLI', () => {
  it('prints raw detections by default', () => {
    const output = execFileSync(process.execPath, [cliPath, fixturePath], {cwd: projectRoot, encoding: 'utf-8'});
    assert.match(output, /\[\+\] array_function_replacements, augmented_array_function_replacements, obfuscator_io/);
  });

  it('prints reduced detections when requested', () => {
    const output = execFileSync(process.execPath, [cliPath, fixturePath, '--reduced'], {cwd: projectRoot, encoding: 'utf-8'});
    assert.match(output, /\[\+\] obfuscator_io/);
  });

  it('prints detailed metadata in text mode when requested', () => {
    const output = execFileSync(process.execPath, [cliPath, fixturePath, '--detailed'], {cwd: projectRoot, encoding: 'utf-8'});
    assert.match(output, /\[\+\] array_function_replacements/);
    assert.match(output, /prioritizeOver: \(none\)/);
    assert.match(output, /suppressedBy: augmented_array_function_replacements, obfuscator_io/);
    assert.match(output, /\[\+\] augmented_array_function_replacements/);
    assert.match(output, /prioritizeOver: array_function_replacements/);
    assert.match(output, /suppressedBy: obfuscator_io/);
    assert.match(output, /\[\+\] obfuscator_io/);
    assert.match(output, /suppressedBy: \(none\)/);
  });

  it('prints detailed json when requested', () => {
    const output = execFileSync(process.execPath, [cliPath, fixturePath, '--detailed', '--json'], {cwd: projectRoot, encoding: 'utf-8'});
    const parsed = JSON.parse(output);
    assert.deepStrictEqual(parsed.map(result => result.name), [
      'array_function_replacements',
      'augmented_array_function_replacements',
      'obfuscator_io',
    ]);
  });
});
