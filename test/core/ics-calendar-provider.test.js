const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadIcsProviderModule() {
    const modulePath = path.resolve(__dirname, '../../src/core/providers/ics-calendar-provider.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

async function readFixture(name) {
    return fs.readFile(path.resolve(__dirname, '..', 'fixtures', name), 'utf8');
}

// ---------------------------------------------------------------------------
// Existing NRW .ics files in the repository root
// ---------------------------------------------------------------------------

test('IcsCalendarProvider parses feiertage_nrw.ics without errors', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await fs.readFile(
        path.resolve(__dirname, '../../feiertage_nrw.ics'),
        'utf8'
    );

    const provider = new IcsCalendarProvider([
        { id: 'feiertage-nrw', name: 'NRW Feiertage', color: '#ef4444', content }
    ]);

    const calendars = await provider.fetchCalendars();
    assert.equal(calendars.length, 1);
    assert.equal(calendars[0].id, 'feiertage-nrw');
    assert.equal(calendars[0].name, 'NRW Feiertage');
    assert.equal(calendars[0].color, '#ef4444');

    const events2026 = await provider.fetchCalendarEvents(2026);
    assert.ok(events2026.length > 0, 'expected events in 2026 from feiertage_nrw.ics');
    assert.ok(events2026.every((ev) => ev.calendarId === 'feiertage-nrw'));
    assert.ok(events2026.every((ev) => ev.allDay === true), 'NRW holidays should be all-day');
    assert.ok(events2026.every((ev) => ev.start instanceof Date));
    assert.ok(events2026.every((ev) => ev.end instanceof Date));
});

test('IcsCalendarProvider parses ferien_nrw.ics without errors', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await fs.readFile(
        path.resolve(__dirname, '../../ferien_nrw.ics'),
        'utf8'
    );

    const provider = new IcsCalendarProvider([
        { id: 'ferien-nrw', name: 'NRW Schulferien', color: '#0ea5e9', content }
    ]);

    const events2026 = await provider.fetchCalendarEvents(2026);
    assert.ok(events2026.length > 0, 'expected school holidays in 2026');
    assert.ok(events2026.every((ev) => ev.allDay === true), 'school holidays should be all-day');

    // Verify specific known entries
    const sommerferien = events2026.find((ev) => ev.title === 'Sommerferien 2026 Nordrhein-Westfalen');
    assert.ok(sommerferien, 'expected Sommerferien 2026');
    assert.equal(sommerferien.start.getFullYear(), 2026);
    assert.equal(sommerferien.start.getMonth(), 6); // July (0-indexed)
    assert.equal(sommerferien.start.getDate(), 20);
});

test('IcsCalendarProvider returns only events overlapping the requested year', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await fs.readFile(
        path.resolve(__dirname, '../../ferien_nrw.ics'),
        'utf8'
    );

    const provider = new IcsCalendarProvider([
        { id: 'ferien-nrw', name: 'NRW Schulferien', color: '#0ea5e9', content }
    ]);

    const events2020 = await provider.fetchCalendarEvents(2020);
    const events2030 = await provider.fetchCalendarEvents(2030);

    assert.ok(events2020.length > 0, 'expected events in 2020');
    assert.equal(events2030.length, 0, 'no events expected in 2030');

    // Each event must genuinely overlap the year
    for (const ev of events2020) {
        const startYear = ev.start.getFullYear();
        const endYear = ev.end.getFullYear();
        assert.ok(
            startYear === 2020 || endYear === 2020 || (startYear < 2020 && endYear > 2020),
            `event "${ev.title}" does not overlap 2020`
        );
    }
});

// ---------------------------------------------------------------------------
// Fixture files mirroring the dummy calendar data
// ---------------------------------------------------------------------------

test('IcsCalendarProvider fetchCalendars returns all calendars from fixture files', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const [work, personal, project, holidays] = await Promise.all([
        readFixture('work-calendar.ics'),
        readFixture('personal-calendar.ics'),
        readFixture('project-calendar.ics'),
        readFixture('holidays-calendar.ics')
    ]);

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content: work },
        { id: 'ics-personal', name: 'Personal', color: '#22c55e', content: personal },
        { id: 'ics-project', name: 'Project X', color: '#f97316', content: project },
        { id: 'ics-holidays', name: 'Holidays', color: '#ef4444', content: holidays }
    ]);

    const calendars = await provider.fetchCalendars();
    assert.equal(calendars.length, 4);
    assert.deepEqual(
        calendars.map((c) => c.id),
        ['ics-work', 'ics-personal', 'ics-project', 'ics-holidays']
    );
    assert.deepEqual(
        calendars.map((c) => c.name),
        ['Work', 'Personal', 'Project X', 'Holidays']
    );
});

test('IcsCalendarProvider returns events from all fixture calendars for 2026', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const [work, personal, project, holidays] = await Promise.all([
        readFixture('work-calendar.ics'),
        readFixture('personal-calendar.ics'),
        readFixture('project-calendar.ics'),
        readFixture('holidays-calendar.ics')
    ]);

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content: work },
        { id: 'ics-personal', name: 'Personal', color: '#22c55e', content: personal },
        { id: 'ics-project', name: 'Project X', color: '#f97316', content: project },
        { id: 'ics-holidays', name: 'Holidays', color: '#ef4444', content: holidays }
    ]);

    const events2026 = await provider.fetchCalendarEvents(2026);
    assert.ok(events2026.length > 0, 'expected events in 2026');

    const calIds = new Set(events2026.map((ev) => ev.calendarId));
    assert.ok(calIds.has('ics-work'), 'expected work events');
    assert.ok(calIds.has('ics-personal'), 'expected personal events');
    assert.ok(calIds.has('ics-project'), 'expected project events');
    assert.ok(calIds.has('ics-holidays'), 'expected holiday events');
});

test('IcsCalendarProvider filters events by calendarIds', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const [work, personal] = await Promise.all([
        readFixture('work-calendar.ics'),
        readFixture('personal-calendar.ics')
    ]);

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content: work },
        { id: 'ics-personal', name: 'Personal', color: '#22c55e', content: personal }
    ]);

    const workOnly = await provider.fetchCalendarEvents(2026, {
        calendarIds: ['ics-work']
    });

    assert.ok(workOnly.length > 0);
    assert.ok(workOnly.every((ev) => ev.calendarId === 'ics-work'));
});

test('IcsCalendarProvider allDayOnly filter excludes timed events', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await readFixture('work-calendar.ics');

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content }
    ]);

    const allEvents = await provider.fetchCalendarEvents(2026);
    const timedEvents = allEvents.filter((ev) => !ev.allDay);
    assert.ok(timedEvents.length > 0, 'fixture must include timed events for this test to be meaningful');

    const allDayEvents = await provider.fetchCalendarEvents(2026, { allDayOnly: true });
    assert.ok(allDayEvents.every((ev) => ev.allDay === true));
    assert.ok(allDayEvents.length < allEvents.length);
});

test('IcsCalendarProvider per-calendar allDayModes override global allDayOnly', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const [work, project] = await Promise.all([
        readFixture('work-calendar.ics'),
        readFixture('project-calendar.ics')
    ]);

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content: work },
        { id: 'ics-project', name: 'Project X', color: '#f97316', content: project }
    ]);

    // Global allDayOnly: true, but work is overridden to 'no' (allow timed)
    const events = await provider.fetchCalendarEvents(2026, {
        calendarIds: ['ics-work', 'ics-project'],
        allDayOnly: true,
        calendarAllDayModes: {
            'ics-work': 'no',    // allow timed events from work
            'ics-project': 'yes' // only all-day from project
        }
    });

    assert.ok(events.length > 0);
    // Work can have timed events
    assert.ok(events.some((ev) => ev.calendarId === 'ics-work' && ev.allDay === false));
    // Project must be all-day only
    assert.ok(events.every((ev) => ev.calendarId !== 'ics-project' || ev.allDay === true));
});

test('IcsCalendarProvider handles timed events correctly', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await readFixture('work-calendar.ics');

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content }
    ]);

    const events = await provider.fetchCalendarEvents(2026);
    const designReview = events.find((ev) => ev.title === 'Design review');

    assert.ok(designReview, 'expected "Design review" event in 2026');
    assert.equal(designReview.allDay, false);
    assert.equal(designReview.start.getFullYear(), 2026);
    assert.equal(designReview.start.getMonth(), 1); // February (0-indexed)
    assert.equal(designReview.start.getDate(), 12);
    assert.equal(designReview.description, 'Quarterly design review session');
    assert.equal(designReview.location, 'Conference Room A');
    assert.equal(designReview.calendarName, 'Work');
    assert.equal(designReview.calendarColor, '#0ea5e9');
});

test('IcsCalendarProvider handles events spanning a year boundary', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await readFixture('personal-calendar.ics');

    const provider = new IcsCalendarProvider([
        { id: 'ics-personal', name: 'Personal', color: '#22c55e', content }
    ]);

    // "Year handover" starts Dec 29 of previous year and ends Jan 10 of current year.
    const events2026 = await provider.fetchCalendarEvents(2026);
    const yearHandover = events2026.find((ev) => ev.title === 'Year handover');
    assert.ok(yearHandover, 'expected "Year handover" to appear in 2026 because its end is Jan 10 2026');
    assert.equal(yearHandover.start.getFullYear(), 2025);
    assert.equal(yearHandover.end.getFullYear(), 2026);

    // The same event should also appear when fetching 2025 (it starts in 2025).
    const events2025 = await provider.fetchCalendarEvents(2025);
    const yearHandover2025 = events2025.find(
        (ev) => ev.title === 'Year handover' && ev.start.getFullYear() === 2025
    );
    assert.ok(yearHandover2025, 'expected same "Year handover" to appear in 2025 as well');
});

test('IcsCalendarProvider returns empty result for a year with no events', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await readFixture('work-calendar.ics');

    const provider = new IcsCalendarProvider([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content }
    ]);

    const events = await provider.fetchCalendarEvents(2000);
    assert.deepEqual(events, []);
});

test('IcsCalendarProvider with no calendars returns empty arrays', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();

    const provider = new IcsCalendarProvider([]);

    assert.deepEqual(await provider.fetchCalendars(), []);
    assert.deepEqual(await provider.fetchCalendarEvents(2026), []);
});

test('IcsCalendarProvider handles empty or invalid ICS content gracefully', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();

    const provider = new IcsCalendarProvider([
        { id: 'empty', name: 'Empty', color: null, content: '' },
        { id: 'garbage', name: 'Garbage', color: null, content: 'this is not ical' }
    ]);

    const calendars = await provider.fetchCalendars();
    assert.equal(calendars.length, 2);

    const events = await provider.fetchCalendarEvents(2026);
    assert.deepEqual(events, []);
});

test('IcsCalendarProvider sets calendarId, calendarName and calendarColor on every event', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const content = await readFixture('holidays-calendar.ics');

    const provider = new IcsCalendarProvider([
        { id: 'ics-holidays', name: 'Holidays', color: '#ef4444', content }
    ]);

    const events = await provider.fetchCalendarEvents(2026);
    assert.ok(events.length > 0);
    for (const ev of events) {
        assert.equal(ev.calendarId, 'ics-holidays');
        assert.equal(ev.calendarName, 'Holidays');
        assert.equal(ev.calendarColor, '#ef4444');
    }
});

test('IcsCalendarProvider is compatible with the calendar-service setCalendarProvider API', async () => {
    const { IcsCalendarProvider } = await loadIcsProviderModule();
    const calendarServicePath = path.resolve(
        __dirname, '../../src/core/providers/calendar-service.js'
    );
    const calendarService = await import(`file://${calendarServicePath.replace(/\\/g, '/')}`);

    const content = await readFixture('holidays-calendar.ics');
    const provider = new IcsCalendarProvider([
        { id: 'ics-holidays', name: 'Holidays', color: '#ef4444', content }
    ]);

    calendarService.setCalendarProvider(provider);
    try {
        const calendars = await calendarService.fetchCalendars();
        assert.equal(calendars.length, 1);
        assert.equal(calendars[0].id, 'ics-holidays');

        const events = await calendarService.fetchCalendarEvents(2026);
        assert.ok(events.length > 0);
    } finally {
        calendarService.setCalendarProvider(null);
    }
});
