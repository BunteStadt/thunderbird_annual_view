const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// event-store.js imports calendar-service.js and date-utils.js with relative
// specifiers, so load it via a file URL to keep module resolution intact.
async function loadEventStoreModule() {
    const modulePath = path.resolve(__dirname, '../../src/core/domain/event-store.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

async function setFixtureCalendars(calendarService) {
    const fixturePath = (name) => path.resolve(__dirname, '../fixtures', name);
    const readFixture = (name) => fs.readFile(fixturePath(name), 'utf8');
    calendarService.setIcsCalendars([
        { id: 'ics-work', name: 'Work', content: await readFixture('work-calendar.ics') },
        { id: 'ics-personal', name: 'Personal', content: await readFixture('personal-calendar.ics') },
        { id: 'ics-project', name: 'Project', content: await readFixture('project-calendar.ics') },
        { id: 'ics-holidays', name: 'Holidays', content: await readFixture('holidays-calendar.ics') }
    ]);
}

test('EventStore caches years and applies filters without refetching', async (t) => {
    const calendarServicePath = path.resolve(__dirname, '../../src/core/providers/calendar-service.js');
    const calendarService = await import(`file://${calendarServicePath.replace(/\\/g, '/')}`);
    await setFixtureCalendars(calendarService);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    const { EventStore } = await loadEventStoreModule();
    const store = new EventStore();

    const filters = {
        calendarIds: ['ics-work', 'ics-personal', 'ics-project', 'ics-holidays'],
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
        calendarIds: ['ics-work']
    });
    assert.ok(workOnly.events.length > 0);
    assert.ok(workOnly.events.every((ev) => ev.calendarId === 'ics-work'));

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
    const calendarServicePath = path.resolve(__dirname, '../../src/core/providers/calendar-service.js');
    const calendarService = await import(`file://${calendarServicePath.replace(/\\/g, '/')}`);
    await setFixtureCalendars(calendarService);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    const { EventStore } = await loadEventStoreModule();
    const store = new EventStore();

    const raw = await store.getRawEvents(2026, 2027);
    const keys = raw.map((ev) => `${ev.id}|${ev.start?.getTime?.()}`);
    assert.equal(new Set(keys).size, keys.length, 'expected no duplicate events across year fetches');
});

test('EventStore returns nothing when no calendars are selected', async (t) => {
    const calendarServicePath = path.resolve(__dirname, '../../src/core/providers/calendar-service.js');
    const calendarService = await import(`file://${calendarServicePath.replace(/\\/g, '/')}`);
    calendarService.setIcsCalendars([]);
    calendarService.setCalendarProvider(null);

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
