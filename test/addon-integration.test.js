const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function assertFileExists(relativePath) {
    const fullPath = path.join(repoRoot, relativePath);
    assert.equal(fs.existsSync(fullPath), true, `Missing file referenced by manifest: ${relativePath}`);
}

test('manifest references existing addon files', () => {
    const manifestPath = path.join(repoRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    for (const script of manifest.background?.scripts || []) {
        assertFileExists(script);
    }

    for (const iconPath of Object.values(manifest.action?.default_icon || {})) {
        assertFileExists(iconPath);
    }

    for (const icon of manifest.action?.theme_icons || []) {
        assertFileExists(icon.light);
        assertFileExists(icon.dark);
    }

    for (const apiDef of Object.values(manifest.experiment_apis || {})) {
        assertFileExists(apiDef.schema);
        if (apiDef.parent?.script) {
            assertFileExists(apiDef.parent.script);
        }
        if (apiDef.child?.script) {
            assertFileExists(apiDef.child.script);
        }
    }
});

test('addon package can be built and validated as a zip archive', (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-annual-view-ci-'));
    const xpiPath = path.join(tempDir, 'addon.xpi');
    t.after(() => {
        if (fs.existsSync(xpiPath)) {
            fs.unlinkSync(xpiPath);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const build = spawnSync(
        'zip',
        ['-r', xpiPath, 'manifest.json', 'src', 'experiments', 'icons'],
        { cwd: repoRoot, encoding: 'utf8' }
    );
    assert.equal(build.status, 0, `zip command failed: ${build.stderr || build.stdout}`);

    const verify = spawnSync('unzip', ['-t', xpiPath], { encoding: 'utf8' });
    assert.equal(verify.status, 0, `unzip validation failed: ${verify.stderr || verify.stdout}`);
    assert.match(verify.stdout, /No errors detected in compressed data/);

    const list = spawnSync('unzip', ['-l', xpiPath], { encoding: 'utf8' });
    assert.equal(list.status, 0, `Unable to list archive entries: ${list.stderr || list.stdout}`);
    assert.match(list.stdout, /manifest\.json/);
    assert.match(list.stdout, /src\/background\/background\.js/);
    assert.match(list.stdout, /src\/ui\/year-view\/year-view\.html/);
});
