import assert from 'node:assert';
import {describe, it} from 'node:test';
import {detectObfuscation, detectObfuscationDetailed, detectObfuscationReduced} from '../src/index.js';

describe('Functionality', () => {
  it('invalid input should not throw an error', () => {
    assert.doesNotThrow(() => {
      detectObfuscation(Error);
      detectObfuscationReduced(Error);
      detectObfuscationDetailed(Error);
    }, 'Invalid input should not throw an error');
  });

  it('invalid input should return empty arrays for all APIs', () => {
    assert.deepStrictEqual(detectObfuscation(Object), [], 'Raw detection should return an empty array');
    assert.deepStrictEqual(detectObfuscationReduced(Object), [], 'Reduced detection should return an empty array');
    assert.deepStrictEqual(detectObfuscationDetailed(Object), [], 'Detailed detection should return an empty array');
  });
});
