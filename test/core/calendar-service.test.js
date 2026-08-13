const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadCalendarServiceModule() {
    const modulePath = path.resolve(__dirname, '../../src/core/providers/calendar-service.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

async function loadFixture(name) {
    return fs.readFile(path.resolve(__dirname, '../fixtures', name), 'utf8');
}

async function setFixtureCalendars(calendarService) {
    calendarService.setIcsCalendars([
        { id: 'ics-work', name: 'Work', color: '#0ea5e9', content: await loadFixture('work-calendar.ics') },
        { id: 'ics-personal', name: 'Personal', color: '#22c55e', content: await loadFixture('personal-calendar.ics') },
        { id: 'ics-project', name: 'Project', color: '#f97316', content: await loadFixture('project-calendar.ics') },
        { id: 'ics-holidays', name: 'Holidays', color: '#ef4444', content: await loadFixture('holidays-calendar.ics') }
    ]);
}

test('fetchCalendars returns the demo calendars from ICS fixtures', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    await setFixtureCalendars(calendarService);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    const calendars = await calendarService.fetchCalendars();

    assert.equal(calendars.length, 4);
    assert.deepEqual(
        calendars.map((calendar) => calendar.id),
        ['ics-work', 'ics-personal', 'ics-project', 'ics-holidays']
    );
});

test('fetchCalendarEvents applies calendar and all-day filters to ICS calendars', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    await setFixtureCalendars(calendarService);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    const events = await calendarService.fetchCalendarEvents(2026, {
        calendarIds: ['ics-work'],
        allDayOnly: true
    });

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.calendarId === 'ics-work'));
    assert.ok(events.every((event) => event.allDay === true));
});

test('fetchCalendarEvents resolves per-calendar all-day modes against the global setting', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    await setFixtureCalendars(calendarService);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    const events = await calendarService.fetchCalendarEvents(2026, {
        calendarIds: ['ics-work', 'ics-project'],
        allDayOnly: true,
        calendarAllDayModes: {
            'ics-work': 'no',
            'ics-project': 'yes'
        }
    });

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.calendarId === 'ics-work' || event.calendarId === 'ics-project'));
    assert.ok(events.some((event) => event.calendarId === 'ics-work' && event.allDay === false));
    assert.ok(events.every((event) => event.calendarId !== 'ics-project' || event.allDay === true));
});

test('calendar service delegates to an injected provider', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    const provider = {
        async fetchCalendars() {
            return [{ id: 'custom', name: 'Custom', color: '#123456' }];
        },
        async fetchCalendarEvents() {
            return [{
                id: 'event-1',
                calendarId: 'custom',
                title: 'Custom event',
                start: new Date(2026, 0, 1),
                end: new Date(2026, 0, 2),
                allDay: true
            }];
        }
    };

    calendarService.setCalendarProvider(provider);
    t.after(() => {
        calendarService.setCalendarProvider(null);
    });

    assert.deepEqual(await calendarService.fetchCalendars(), [{ id: 'custom', name: 'Custom', color: '#123456' }]);
    assert.equal((await calendarService.fetchCalendarEvents(2026))[0].title, 'Custom event');
});

test('calendar service returns empty arrays when no provider is configured', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(null);

    const calendars = await calendarService.fetchCalendars();
    const events = await calendarService.fetchCalendarEvents(2026, { calendarIds: [], allDayOnly: false });

    assert.deepEqual(calendars, []);
    assert.deepEqual(events, []);
});

test('createCalendarProvider returns an empty provider for unregistered kinds', async () => {
    const calendarService = await loadCalendarServiceModule();

    assert.equal(calendarService.createCalendarProvider('google')?.constructor?.name, 'EmptyCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('thunderbird')?.constructor?.name, 'EmptyCalendarProvider');

    // Hosts can register their own provider factories.
    class FakeHostProvider { }
    calendarService.registerProviderFactory('thunderbird', () => new FakeHostProvider());
    calendarService.registerProviderFactory('google', () => new FakeHostProvider());
    assert.equal(calendarService.createCalendarProvider('thunderbird')?.constructor?.name, 'FakeHostProvider');
    assert.equal(calendarService.createCalendarProvider('google')?.constructor?.name, 'FakeHostProvider');
    assert.equal(calendarService.createCalendarProvider('empty')?.constructor?.name, 'EmptyCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('unknown-kind')?.constructor?.name, 'EmptyCalendarProvider');
});

test('calendar service merges uploaded ICS calendars alongside the active provider', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(null);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    calendarService.setIcsCalendars([
        {
            id: 'ics-imported',
            name: 'ICS Imported',
            color: '#ef4444',
            content: [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'BEGIN:VEVENT',
                'UID:ics-event-1',
                'SUMMARY:Imported holiday',
                'DTSTART;VALUE=DATE:20260101',
                'DTEND;VALUE=DATE:20260102',
                'END:VEVENT',
                'END:VCALENDAR'
            ].join('\n')
        }
    ]);

    const calendars = await calendarService.fetchCalendars();
    const events = await calendarService.fetchCalendarEvents(2026);

    // ICS calendar appears in the calendar list.
    const calendarIds = calendars.map((c) => c.id);
    assert.ok(calendarIds.includes('ics-imported'), 'ICS calendar present in list');

    // ICS event is included in the merged event list
    const icsEvent = events.find((e) => e.calendarId === 'ics-imported');
    assert.ok(icsEvent, 'ICS event present in merged events');
    assert.equal(icsEvent.title, 'Imported holiday');
});

test('calendar service returns no calendars when no provider or ICS calendars are configured', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(null);
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    calendarService.setIcsCalendars([]);

    const calendars = await calendarService.fetchCalendars();

    assert.deepEqual(calendars, []);
});
