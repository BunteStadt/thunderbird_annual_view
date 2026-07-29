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
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
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
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
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
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        delete globalThis.ENABLE_DUMMY_CALENDARS;
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

test('calendar service returns empty arrays when calendar API is unavailable', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    globalThis.ENABLE_DUMMY_CALENDARS = false;
    globalThis.browser = {};
    t.after(() => {
        delete globalThis.browser;
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    const calendars = await calendarService.fetchCalendars();
    const events = await calendarService.fetchCalendarEvents(2026, { calendarIds: [], allDayOnly: false });

    assert.deepEqual(calendars, []);
    assert.deepEqual(events, []);
});

test('calendar service selects Google provider when google mode is enabled', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    globalThis.ENABLE_DUMMY_CALENDARS = false;
    globalThis.ENABLE_GOOGLE_CALENDARS = true;
    globalThis.browser = {};
    t.after(() => {
        delete globalThis.browser;
        delete globalThis.ENABLE_DUMMY_CALENDARS;
        delete globalThis.ENABLE_GOOGLE_CALENDARS;
    });

    const provider = calendarService.createDefaultCalendarProvider();
    assert.equal(provider?.constructor?.name, 'GoogleCalendarProvider');
});

test('calendar service prefers uploaded ICS calendars instead of merging them as an overlay', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        calendarService.setIcsCalendars([]);
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    calendarService.setIcsCalendars([
        {
            id: 'ics-only',
            name: 'ICS Only',
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

    assert.deepEqual(calendars.map((calendar) => calendar.id), ['ics-only']);
    assert.equal(events.length, 1);
    assert.equal(events[0].calendarId, 'ics-only');
    assert.equal(events[0].title, 'Imported holiday');
});

test('calendar service falls back to the default provider when no ICS calendars are uploaded', async (t) => {
    const calendarService = await loadCalendarServiceModule();
    globalThis.ENABLE_DUMMY_CALENDARS = true;
    t.after(() => {
        calendarService.setIcsCalendars([]);
        delete globalThis.ENABLE_DUMMY_CALENDARS;
    });

    calendarService.setIcsCalendars([]);

    const calendars = await calendarService.fetchCalendars();

    assert.deepEqual(
        calendars.map((calendar) => calendar.id),
        ['dummy-work', 'dummy-personal', 'dummy-project', 'dummy-holidays']
    );
});
