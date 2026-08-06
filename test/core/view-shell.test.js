const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'ui', 'view-shell.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'app.js'), 'utf8');

// The view shell in core is the single source of truth for the app markup.
// These guards make it impossible for app.js, the host bootstraps, or the
// host HTML pages to drift away from it.

test('view shell contains every element id initApp reads from the DOM', () => {
    const ids = [...appSource.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, 'expected getElementById ids in app.js');
    for (const id of ids) {
        assert.ok(
            shellSource.includes(`id="${id}"`),
            `view shell is missing #${id} required by app.js`
        );
    }
});

test('view shell contains every data-ui-slot the host bootstraps mount into', () => {
    const slots = new Set();
    for (const mainPath of ['src/hosts/web/main.js', 'src/hosts/thunderbird/main.js']) {
        const source = fs.readFileSync(path.join(repoRoot, mainPath), 'utf8');
        for (const match of source.matchAll(/slot:\s*["']([^"']+)["']/g)) {
            slots.add(match[1]);
        }
    }
    assert.ok(slots.size > 0, 'expected uiModule slots in host bootstraps');
    for (const slot of slots) {
        assert.ok(
            shellSource.includes(`data-ui-slot="${slot}"`),
            `view shell is missing data-ui-slot="${slot}"`
        );
    }
});

test('host HTML pages are thin wrappers that defer markup to the core shell', () => {
    for (const htmlPath of ['src/hosts/thunderbird/year-view.html', 'src/hosts/web/index.html']) {
        const html = fs.readFileSync(path.join(repoRoot, htmlPath), 'utf8');
        assert.ok(!html.includes('id="gridRows"'), `${htmlPath} must not duplicate core view shell markup`);
        assert.ok(!html.includes('id="calendarList"'), `${htmlPath} must not duplicate core view shell markup`);
        assert.match(html, /<script type="module"/, `${htmlPath} must load its host entry module`);
        assert.match(html, /<body/, `${htmlPath} must keep a <body> for the shell`);
    }
    assert.ok(!fs.existsSync(path.join(repoRoot, 'src', 'hosts', 'host-bootstrap.js')));
});
