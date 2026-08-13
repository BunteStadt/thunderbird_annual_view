const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'ui', 'annual-view.tsx'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'app.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'storage.js'), 'utf8');
const onboardingSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'ui', 'onboarding-tour.js'), 'utf8');
const icsSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'ics-calendar-integration.js'), 'utf8');
const demoCalendarsSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'demo-calendars.js'), 'utf8');
const coreHostSource = fs.readFileSync(path.join(repoRoot, 'src', 'hosts', 'core', 'main.js'), 'utf8');
const saasYearViewSource = fs.readFileSync(path.join(repoRoot, 'src', 'hosts', 'saas', 'src', 'year-view.tsx'), 'utf8');

// The view shell in core is the single source of truth for the app markup.
// These guards make it impossible for app.js, the host bootstraps, or the
// host HTML pages to drift away from it.

test('view shell contains every element id initApp reads from the DOM', () => {
    const ids = [...appSource.matchAll(/(?:getElementById|findById)\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, 'expected scoped element ids in app.js');
    for (const id of ids) {
        assert.ok(
            shellSource.includes(`id="${id}"`),
            `view shell is missing #${id} required by app.js`
        );
    }
});

test('React view shell does not force dark mode before theme preferences load', () => {
    assert.doesNotMatch(shellSource, /className="av-app theme-dark"/);
});

test('view shell contains every data-ui-slot the host bootstraps mount into', () => {
    const slots = new Set();
    for (const mainPath of ['src/hosts/thunderbird/main.js', 'src/hosts/saas/src/year-view.tsx']) {
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

test('view shell exposes the core onboarding targets and expanded options by default', () => {
    assert.match(shellSource, /data-tour="calendar-list"/);
    assert.match(shellSource, /data-tour="global-all-day"/);
    assert.match(shellSource, /data-tour="global-duration"/);
    assert.match(shellSource, /data-tour="display-options"/);
    assert.match(shellSource, /data-tour="view-mode"/);
    assert.match(icsSource, /uploadButton\.dataset\.tour = "upload-ics"/);
    assert.match(storageSource, /export async function loadPanelState[\s\S]*return true;/);
    assert.match(appSource, /onboarding-tour/);
    assert.match(onboardingSource, /global-all-day/);
    assert.match(onboardingSource, /specific-all-day/);
    assert.match(onboardingSource, /specific-duration/);
    assert.match(onboardingSource, /waitingForCalendar/);
    assert.match(onboardingSource, /target: "upload-ics"/);
    assert.match(appSource, /hasCalendars: \(\) => availableCalendars\.length > 0/);
    assert.match(appSource, /notifyCalendarStateChanged/);
});

test('Vite builds the one core HTML page with a host selected at compile time', () => {
    const entrySource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'ui', 'entry.tsx'), 'utf8');
    const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.thunderbird.config.mjs'), 'utf8');

    assert.match(entrySource, /from "@calendar-host"/);
    assert.match(entrySource, /mountYearView/);
    assert.match(viteConfig, /src\/hosts\/thunderbird\/main\.js/);
    assert.ok(!fs.existsSync(path.join(repoRoot, 'src', 'hosts', 'thunderbird', 'year-view.html')));
    assert.ok(!fs.existsSync(path.join(repoRoot, 'src', 'hosts', 'host-bootstrap.js')));
});

test('demo hosts load calendars through the removable ICS integration', () => {
    assert.match(coreHostSource, /demoCalendars/);
    assert.match(coreHostSource, /new EmptyCalendarProvider/);
    assert.match(coreHostSource, /demoMode: true/);
    assert.match(demoCalendarsSource, /id: "ics-demo-/);
    assert.match(saasYearViewSource, /icsCalendars: demo \? demoCalendars/);
    assert.match(saasYearViewSource, /demoMode: demo/);
    assert.match(saasYearViewSource, /icsReadOnly: false/);
    assert.match(icsSource, /Restore demo calendars/);
});
