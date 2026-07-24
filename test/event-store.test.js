const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// event-store.js imports calendar-service.js and date-utils.js with relative
// specifiers, so load it via a file URL to keep module resolution intact.
async function loadEventStoreModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/event-store.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('EventStore caches years and applies filters without refetching', async (t) => {
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    const { EventStore } = await loadEventStoreModule();
    const store = new EventStore();

    const filters = {
        calendarIds: ['dummy-work', 'dummy-personal', 'dummy-project', 'dummy-holidays'],
        allDayOnly: false,
        calendarAllDayModes: {},
        getMinDurationMs: () => 0
    };

    const { events, stats } = await store.getFilteredEvents(2026, 2026, filters);
    assert.ok(events.length > 0);
    assert.equal(stats.filteredOut, 0);
    assert.equal(stats.total, events.length);

    // Calendar filter applies on read from the same cache.
    const workOnly = await store.getFilteredEvents(2026, 2026, {
        ...filters,
        calendarIds: ['dummy-work']
    });
    assert.ok(workOnly.events.length > 0);
    assert.ok(workOnly.events.every((ev) => ev.calendarId === 'dummy-work'));

    // Duration filter reports filtered-out counts.
    const longOnly = await store.getFilteredEvents(2026, 2026, {
        ...filters,
        getMinDurationMs: () => 7 * 24 * 60 * 60 * 1000
    });
    assert.ok(longOnly.stats.filteredOut > 0);
    assert.equal(longOnly.stats.total, stats.total);

    // When UI-level duration filtering is off, both all-day and duration filters
    // are bypassed by passing neutral values.
    const strict = await store.getFilteredEvents(2026, 2026, {
        ...filters,
        allDayOnly: true,
        getMinDurationMs: () => 999 * 24 * 60 * 60 * 1000
    });
    assert.ok(strict.events.length < events.length);

    const bypassed = await store.getFilteredEvents(2026, 2026, {
        ...filters,
        allDayOnly: false,
        calendarAllDayModes: {},
        getMinDurationMs: () => 0
    });
    assert.equal(bypassed.events.length, events.length);
    assert.equal(bypassed.stats.filteredOut, 0);
});

test('EventStore deduplicates events that span a year boundary', async (t) => {
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    const { EventStore } = await loadEventStoreModule();
    const store = new EventStore();

    const raw = await store.getRawEvents(2026, 2027);
    const keys = raw.map((ev) => `${ev.id}|${ev.start?.getTime?.()}`);
    assert.equal(new Set(keys).size, keys.length, 'expected no duplicate events across year fetches');
});

test('EventStore returns nothing when no calendars are selected', async (t) => {
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    const { EventStore } = await loadEventStoreModule();
    const store = new EventStore();

    const { events, stats } = await store.getFilteredEvents(2026, 2026, {
        calendarIds: [],
        allDayOnly: false,
        calendarAllDayModes: {},
        getMinDurationMs: () => 0
    });

    assert.deepEqual(events, []);
    assert.deepEqual(stats, { filteredOut: 0, total: 0 });
});
