const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadCalendarServiceModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/calendar-service.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('fetchCalendars returns dummy calendars when enabled', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(calendarService.createCalendarProvider('dummy'));
    t.after(() => {
        calendarService.setCalendarProvider(null);
    });

    const calendars = await calendarService.fetchCalendars();

    assert.equal(calendars.length, 4);
    assert.deepEqual(
        calendars.map((calendar) => calendar.id),
        ['dummy-work', 'dummy-personal', 'dummy-project', 'dummy-holidays']
    );
});

test('fetchCalendarEvents applies calendar and all-day filters in dummy mode', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(calendarService.createCalendarProvider('dummy'));
    t.after(() => {
        calendarService.setCalendarProvider(null);
    });

    const events = await calendarService.fetchCalendarEvents(2026, {
        calendarIds: ['dummy-work'],
        allDayOnly: true
    });

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.calendarId === 'dummy-work'));
    assert.ok(events.every((event) => event.allDay === true));
});

test('fetchCalendarEvents resolves per-calendar all-day modes against the global setting', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(calendarService.createCalendarProvider('dummy'));
    t.after(() => {
        calendarService.setCalendarProvider(null);
    });

    const events = await calendarService.fetchCalendarEvents(2026, {
        calendarIds: ['dummy-work', 'dummy-project'],
        allDayOnly: true,
        calendarAllDayModes: {
            'dummy-work': 'no',
            'dummy-project': 'yes'
        }
    });

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.calendarId === 'dummy-work' || event.calendarId === 'dummy-project'));
    assert.ok(events.some((event) => event.calendarId === 'dummy-work' && event.allDay === false));
    assert.ok(events.every((event) => event.calendarId !== 'dummy-project' || event.allDay === true));
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

test('createCalendarProvider maps each kind to the matching provider class', async () => {
    const calendarService = await loadCalendarServiceModule();

    assert.equal(calendarService.createCalendarProvider('dummy')?.constructor?.name, 'DummyCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('google')?.constructor?.name, 'GoogleCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('thunderbird')?.constructor?.name, 'ThunderbirdCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('empty')?.constructor?.name, 'EmptyCalendarProvider');
    assert.equal(calendarService.createCalendarProvider('unknown-kind')?.constructor?.name, 'EmptyCalendarProvider');
});

test('calendar service merges uploaded ICS calendars alongside the active provider', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(calendarService.createCalendarProvider('dummy'));
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

    // ICS calendar appears alongside dummy provider calendars
    const calendarIds = calendars.map((c) => c.id);
    assert.ok(calendarIds.includes('ics-imported'), 'ICS calendar present in list');
    assert.ok(calendarIds.includes('dummy-work'), 'main provider calendars still present');

    // ICS event is included in the merged event list
    const icsEvent = events.find((e) => e.calendarId === 'ics-imported');
    assert.ok(icsEvent, 'ICS event present in merged events');
    assert.equal(icsEvent.title, 'Imported holiday');
});

test('calendar service falls back to the default provider when no ICS calendars are uploaded', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    calendarService.setCalendarProvider(calendarService.createCalendarProvider('dummy'));
    t.after(() => {
        calendarService.setIcsCalendars([]);
        calendarService.setCalendarProvider(null);
    });

    calendarService.setIcsCalendars([]);

    const calendars = await calendarService.fetchCalendars();

    assert.deepEqual(
        calendars.map((calendar) => calendar.id),
        ['dummy-work', 'dummy-personal', 'dummy-project', 'dummy-holidays']
    );
});
