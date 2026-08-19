const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coreRoot = path.resolve(__dirname, '..', '..', 'src', 'core');

function listJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listJsFiles(fullPath));
        } else if (entry.isFile() && /\.(js|ts|tsx)$/.test(entry.name)) {
            out.push(fullPath);
        }
    }
    return out;
}

test('core files never reference browser.* / messenger.* APIs or host modules', () => {
    const files = listJsFiles(coreRoot);
    assert.ok(files.length > 0, 'expected core files to exist');

    for (const file of files) {
        const relative = path.relative(coreRoot, file).replace(/\\/g, '/');
        const source = fs.readFileSync(file, 'utf8');

        // storage-port.js is the only core file allowed to touch platform storage.
        if (relative !== 'storage-port.js') {
            assert.ok(
                !/\bbrowser\./.test(source),
                `${relative} must not reference browser.* APIs`
            );
            assert.ok(
                !/\blocalStorage\b/.test(source),
                `${relative} must not reference localStorage`
            );
        }
        assert.ok(
            !/\bmessenger\./.test(source),
            `${relative} must not reference messenger.* APIs`
        );

        const importPaths = [...source.matchAll(/import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
        for (const importPath of importPaths) {
            assert.ok(
                !importPath.includes('hosts/'),
                `${relative} must not import from hosts/ (found ${importPath})`
            );
        }
    }
});
