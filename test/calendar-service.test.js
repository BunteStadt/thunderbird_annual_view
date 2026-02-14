const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadCalendarServiceModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/calendar-service.js');
    const source = await fs.readFile(modulePath, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(moduleUrl);
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
