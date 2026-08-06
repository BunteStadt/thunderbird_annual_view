const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadDeepLinksModule() {
    const modulePath = path.resolve(__dirname, '../../../src/hosts/web/deep-links.js');
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('parseYearHash accepts #/<year> within range and rejects everything else', async () => {
    const { parseYearHash, formatYearHash } = await loadDeepLinksModule();

    assert.equal(parseYearHash('#/2026'), 2026);
    assert.equal(parseYearHash('#/1900'), 1900);
    assert.equal(parseYearHash('#/2999'), 2999);

    assert.equal(parseYearHash('#/1899'), null);
    assert.equal(parseYearHash('#/3000'), null);
    assert.equal(parseYearHash('#/26'), null);
    assert.equal(parseYearHash('#/20261'), null);
    assert.equal(parseYearHash('#/abcd'), null);
    assert.equal(parseYearHash('#2026'), null);
    assert.equal(parseYearHash(''), null);
    assert.equal(parseYearHash(null), null);
    assert.equal(parseYearHash(undefined), null);

    assert.equal(formatYearHash(2028), '#/2028');
});
