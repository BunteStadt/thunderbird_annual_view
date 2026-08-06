/**
 * Integration test for ThunderbirdCalendarProvider.
 *
 * Simulates the environment the add-on runs in when installed from source in
 * Thunderbird by mocking the browser.calendar experiment API.  The mock feeds
 * real ICS data from feiertage_nrw.ics so that the provider's parsing logic is
 * exercised against genuine calendar content.
 *
 * What this tests:
 *   1. The add-on source is install-ready: all files referenced by manifest.json
 *      exist and the experiment API schemas are readable.
 *   2. ThunderbirdCalendarProvider.fetchCalendars() correctly maps the
 *      calendar metadata returned by the Thunderbird API.
 *   3. ThunderbirdCalendarProvider.fetchCalendarEvents() correctly parses ICS
 *      items returned by Thunderbird into normalised event objects.
 *   4. The all-day filter is applied correctly when querying by calendar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const icsFilePath = path.join(repoRoot, 'assets', 'feiertage_nrw.ics');

function resolveHostFile(manifestRoot, relativePath) {
    if (relativePath.startsWith('experiments/')) {
        return path.join(manifestRoot, 'submodules', 'calendar', relativePath);
    }
    return path.join(manifestRoot, relativePath);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw ICS text and return one mock item per VEVENT block.
 * The returned shape mirrors what browser.calendar.items.query yields when
 * returnFormat is "ical": an array of { id, item } objects.
 *
 * @param {string} icsContent  Raw ICS file content.
 * @returns {{ id: string, item: string }[]}
 */
function icsToMockItems(icsContent) {
    const items = [];
    const veventRegex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/gm;
    let match;
    while ((match = veventRegex.exec(icsContent)) !== null) {
        const vevent = match[0];
        const uid = vevent.match(/^UID:(.+)$/m)?.[1]?.trim() ?? `uid-${items.length}`;
        items.push({ id: uid, item: vevent });
    }
    return items;
}

/**
 * Filter mock items to those whose DTSTART falls inside [rangeStart, rangeEnd]
 * (both inclusive, YYYYMMDD format), matching Thunderbird's range query.
 *
 * @param {{ id: string, item: string }[]} items
 * @param {string} rangeStart  YYYYMMDD
 * @param {string} rangeEnd    YYYYMMDD
 */
function filterByRange(items, rangeStart, rangeEnd) {
    return items.filter(({ item }) => {
        const raw = item.match(/DTSTART(?:[^:\r\n]*):([^\r\n]+)/m)?.[1] ?? '';
        const dateStr = raw.replace(/\D/g, '').slice(0, 8);
        return dateStr >= rangeStart && dateStr <= rangeEnd;
    });
}

/**
 * Dynamically import the ThunderbirdCalendarProvider ES module.
 * The module is loaded fresh each call because Node's import cache is keyed by
 * URL; since the URL is constant the cached instance is reused, which is fine
 * here because the provider reads globalThis.browser at call time.
 */
async function loadProvider() {
    const modulePath = path.resolve(repoRoot, 'src/hosts/thunderbird/thunderbird-calendar-provider.js');
    const { ThunderbirdCalendarProvider } = await import(`file://${modulePath}`);
    return ThunderbirdCalendarProvider;
}

// ---------------------------------------------------------------------------
// Test: add-on source install-readiness
// ---------------------------------------------------------------------------

test('manifest.json references all experiment API schema and script files', () => {
    const manifestRoot = path.join(repoRoot, 'src', 'hosts', 'thunderbird');
    const manifest = JSON.parse(fs.readFileSync(path.join(manifestRoot, 'manifest.json'), 'utf8'));
    for (const [apiName, apiDef] of Object.entries(manifest.experiment_apis ?? {})) {
        const schemaPath = resolveHostFile(manifestRoot, apiDef.schema);
        assert.ok(
            fs.existsSync(schemaPath),
            `Missing experiment API schema for "${apiName}": ${apiDef.schema}`
        );
        // Verify the schema is valid JSON
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        assert.ok(Array.isArray(schema), `Schema for "${apiName}" should be a JSON array`);

        if (apiDef.parent?.script) {
            assert.ok(
                fs.existsSync(resolveHostFile(manifestRoot, apiDef.parent.script)),
                `Missing parent script for "${apiName}": ${apiDef.parent.script}`
            );
        }
        if (apiDef.child?.script) {
            assert.ok(
                fs.existsSync(resolveHostFile(manifestRoot, apiDef.child.script)),
                `Missing child script for "${apiName}": ${apiDef.child.script}`
            );
        }
    }
});

test('manifest.json declares the required gecko browser_specific_settings for Thunderbird', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'hosts', 'thunderbird', 'manifest.json'), 'utf8'));
    const gecko = manifest.browser_specific_settings?.gecko;
    assert.ok(gecko, 'manifest.json must have browser_specific_settings.gecko');
    assert.ok(gecko.id, 'gecko settings must include an id');
    assert.ok(gecko.strict_min_version, 'gecko settings must include strict_min_version');
    assert.ok(gecko.strict_max_version, 'gecko settings must include strict_max_version');
});

// ---------------------------------------------------------------------------
// Test: fetchCalendars
// ---------------------------------------------------------------------------

test('ThunderbirdCalendarProvider.fetchCalendars maps Thunderbird calendar metadata', async (t) => {
    const mockCalendars = [
        { id: 'cal-feiertage', name: 'NRW Feiertage', color: '#FF0000' },
        { id: 'cal-ferien', name: 'NRW Ferien', color: '#0000FF' }
    ];

    globalThis.browser = {
        calendar: {
            calendars: { async query() { return mockCalendars; } },
            items: { async query() { return []; } }
        }
    };
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();
    const calendars = await provider.fetchCalendars();

    assert.equal(calendars.length, 2);
    assert.deepEqual(calendars.map((c) => c.id), ['cal-feiertage', 'cal-ferien']);
    assert.equal(calendars[0].name, 'NRW Feiertage');
    assert.equal(calendars[0].color, '#FF0000');
    assert.equal(calendars[1].name, 'NRW Ferien');
});

test('ThunderbirdCalendarProvider.fetchCalendars returns empty array when API is absent', async (t) => {
    globalThis.browser = {};
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();
    const calendars = await provider.fetchCalendars();
    assert.deepEqual(calendars, []);
});

// ---------------------------------------------------------------------------
// Test: fetchCalendarEvents — ICS round-trip with real feiertage_nrw.ics data
// ---------------------------------------------------------------------------

test('ThunderbirdCalendarProvider.fetchCalendarEvents loads events from ICS items', async (t) => {
    const icsContent = fs.readFileSync(icsFilePath, 'utf8');
    const allItems = icsToMockItems(icsContent);

    const mockCalendars = [{ id: 'cal-feiertage', name: 'NRW Feiertage', color: '#FF0000' }];

    globalThis.browser = {
        calendar: {
            calendars: { async query() { return mockCalendars; } },
            items: {
                async query({ rangeStart, rangeEnd }) {
                    return filterByRange(allItems, rangeStart, rangeEnd);
                }
            }
        }
    };
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();
    const events = await provider.fetchCalendarEvents(2026);

    // feiertage_nrw.ics contains exactly 11 NRW public holidays for 2026
    assert.equal(events.length, 11, `Expected 11 NRW public holidays for 2026, got ${events.length}`);

    // Every event must reference the mocked calendar
    assert.ok(events.every((e) => e.calendarId === 'cal-feiertage'));

    // NRW public holidays are all all-day events
    assert.ok(events.every((e) => e.allDay === true), 'All NRW public holidays must be all-day events');

    // Dates must be valid
    assert.ok(events.every((e) => e.start instanceof Date && !Number.isNaN(e.start.getTime())));
    assert.ok(events.every((e) => e.end instanceof Date && !Number.isNaN(e.end.getTime())));

    // All events must fall within or start in 2026
    assert.ok(events.every((e) => e.start.getFullYear() === 2026));

    // calendarName and calendarColor are propagated from the calendar object
    assert.ok(events.every((e) => e.calendarName === 'NRW Feiertage'));
    assert.ok(events.every((e) => e.calendarColor === '#FF0000'));
});

test('ThunderbirdCalendarProvider.fetchCalendarEvents includes Neujahr on 2026-01-01', async (t) => {
    const icsContent = fs.readFileSync(icsFilePath, 'utf8');
    const allItems = icsToMockItems(icsContent);
    const mockCalendars = [{ id: 'cal-feiertage', name: 'NRW Feiertage', color: '#FF0000' }];

    globalThis.browser = {
        calendar: {
            calendars: { async query() { return mockCalendars; } },
            items: {
                async query({ rangeStart, rangeEnd }) {
                    return filterByRange(allItems, rangeStart, rangeEnd);
                }
            }
        }
    };
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();
    const events = await provider.fetchCalendarEvents(2026);

    const neujahr = events.find((e) => e.title === 'Neujahr');
    assert.ok(neujahr, 'Expected a "Neujahr" event for 2026');
    assert.equal(neujahr.start.getFullYear(), 2026);
    assert.equal(neujahr.start.getMonth(), 0);   // January
    assert.equal(neujahr.start.getDate(), 1);
});

test('ThunderbirdCalendarProvider.fetchCalendarEvents respects calendarIds filter', async (t) => {
    const icsContent = fs.readFileSync(icsFilePath, 'utf8');
    const allItems = icsToMockItems(icsContent);

    const mockCalendars = [
        { id: 'cal-feiertage', name: 'NRW Feiertage', color: '#FF0000' },
        { id: 'cal-other', name: 'Other', color: '#00FF00' }
    ];

    globalThis.browser = {
        calendar: {
            calendars: { async query() { return mockCalendars; } },
            items: {
                async query({ calendarId, rangeStart, rangeEnd }) {
                    if (calendarId === 'cal-feiertage') {
                        return filterByRange(allItems, rangeStart, rangeEnd);
                    }
                    return [];
                }
            }
        }
    };
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();

    // Only request the feiertage calendar
    const events = await provider.fetchCalendarEvents(2026, { calendarIds: ['cal-feiertage'] });
    assert.ok(events.length > 0, 'Expected events from cal-feiertage');
    assert.ok(events.every((e) => e.calendarId === 'cal-feiertage'));

    // Requesting only the empty calendar should return nothing
    const noEvents = await provider.fetchCalendarEvents(2026, { calendarIds: ['cal-other'] });
    assert.deepEqual(noEvents, []);
});

test('ThunderbirdCalendarProvider.fetchCalendarEvents handles API error gracefully', async (t) => {
    const mockCalendars = [{ id: 'cal-broken', name: 'Broken', color: null }];

    globalThis.browser = {
        calendar: {
            calendars: { async query() { return mockCalendars; } },
            items: {
                async query() { throw new Error('simulated API failure'); }
            }
        }
    };
    t.after(() => { delete globalThis.browser; });

    const ThunderbirdCalendarProvider = await loadProvider();
    const provider = new ThunderbirdCalendarProvider();

    // Should not throw; the provider logs the error and skips the calendar
    const events = await provider.fetchCalendarEvents(2026);
    assert.deepEqual(events, []);
});
