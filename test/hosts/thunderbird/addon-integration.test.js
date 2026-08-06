const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function assertFileExists(relativePath) {
    const fullPath = path.join(repoRoot, relativePath);
    assert.equal(fs.existsSync(fullPath), true, `Missing file referenced by manifest: ${relativePath}`);
}

function resolveHostFile(relativePath) {
    if (relativePath.startsWith('src/')) {
        return relativePath;
    }
    if (relativePath.startsWith('experiments/')) {
        return path.join('src', 'hosts', 'thunderbird', 'submodules', 'calendar', relativePath);
    }
    return path.join('src', 'hosts', 'thunderbird', relativePath);
}

test('manifest references existing addon files', () => {
    const manifestPath = path.join(repoRoot, 'src', 'hosts', 'thunderbird', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    for (const script of manifest.background?.scripts || []) {
        assertFileExists(resolveHostFile(script));
    }

    for (const iconPath of Object.values(manifest.action?.default_icon || {})) {
        assertFileExists(iconPath);
    }

    for (const icon of manifest.action?.theme_icons || []) {
        assertFileExists(icon.light);
        assertFileExists(icon.dark);
    }

    for (const apiDef of Object.values(manifest.experiment_apis || {})) {
        assertFileExists(resolveHostFile(apiDef.schema));
        if (apiDef.parent?.script) {
            assertFileExists(resolveHostFile(apiDef.parent.script));
        }
        if (apiDef.child?.script) {
            assertFileExists(resolveHostFile(apiDef.child.script));
        }
    }
});

test('addon package builds from the Vite Thunderbird output', () => {
    const build = spawnSync('bash', ['assets/scripts/build-xpi.sh'], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(build.status, 0, `XPI build failed: ${build.stderr || build.stdout}`);

    const xpiPath = path.join(repoRoot, 'dist', 'calendar-annual-view.xpi');
    const verify = spawnSync('unzip', ['-t', xpiPath], { encoding: 'utf8' });
    assert.equal(verify.status, 0, `unzip validation failed: ${verify.stderr || verify.stdout}`);
    assert.match(verify.stdout, /No errors detected in compressed data/);

    const list = spawnSync('unzip', ['-l', xpiPath], { encoding: 'utf8' });
    assert.equal(list.status, 0, `Unable to list archive entries: ${list.stderr || list.stdout}`);
    assert.match(list.stdout, /manifest\.json/);
    assert.match(list.stdout, /src\/hosts\/thunderbird\/background\.js/);
    assert.match(list.stdout, /index\.html/);
    assert.match(list.stdout, /assets\/index\.js/);
    assert.match(list.stdout, /experiments\/calendar\/ext-calendar-utils\.sys\.mjs/);
});
