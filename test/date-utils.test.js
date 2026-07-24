const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadDateUtilsModule() {
    const modulePath = path.resolve(__dirname, '../apps/thunderbird-addon/src/ui/year-view/date-utils.js');
    const source = await fs.readFile(modulePath, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(moduleUrl);
}

test('daysInMonth handles leap years', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2024, 1), 29);
    assert.equal(daysInMonth(2025, 1), 28);
    assert.equal(daysInMonth(2026, 0), 31);
    assert.equal(daysInMonth(2026, 3), 30);
});

test('dayNumber and dateFromDayNumber round-trip across year boundaries', async () => {
    const { dayNumber, dateFromDayNumber } = await loadDateUtilsModule();

    const dec31 = new Date(2026, 11, 31);
    const jan1 = new Date(2027, 0, 1);
    assert.equal(dayNumber(jan1) - dayNumber(dec31), 1);

    const roundTrip = dateFromDayNumber(dayNumber(dec31));
    assert.equal(roundTrip.getFullYear(), 2026);
    assert.equal(roundTrip.getMonth(), 11);
    assert.equal(roundTrip.getDate(), 31);
});

test('getISOWeekNumber follows ISO 8601', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    // 2026-01-01 is a Thursday -> ISO week 1.
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2026, 0, 1))), 1);
    // 2027-01-01 is a Friday -> belongs to week 53 of 2026.
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2027, 0, 1))), 53);
});

test('isAllDayEvent detects flagged and midnight-aligned events', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();

    assert.equal(isAllDayEvent({ allDay: true }), true);
    assert.equal(isAllDayEvent({ isAllDay: true }), true);
    assert.equal(
        isAllDayEvent({ start: new Date(2026, 0, 1), end: new Date(2026, 0, 3) }),
        true
    );
    assert.equal(
        isAllDayEvent({ start: new Date(2026, 0, 1, 9), end: new Date(2026, 0, 1, 17) }),
        false
    );
});

test('eventDurationMs treats all-day end dates as exclusive', async () => {
    const { eventDurationMs, MS_PER_DAY } = await loadDateUtilsModule();

    const allDay = { allDay: true, start: new Date(2026, 0, 1), end: new Date(2026, 0, 3) };
    assert.equal(eventDurationMs(allDay), 2 * MS_PER_DAY);

    const timed = { start: new Date(2026, 0, 1, 9), end: new Date(2026, 0, 1, 13) };
    assert.equal(eventDurationMs(timed), 4 * 60 * 60 * 1000);
});

test('parseCalendarDate handles iCal and ISO formats', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();

    const dateOnly = parseCalendarDate('20260714');
    assert.equal(dateOnly.getFullYear(), 2026);
    assert.equal(dateOnly.getMonth(), 6);
    assert.equal(dateOnly.getDate(), 14);

    const dateTime = parseCalendarDate('20260714T093000');
    assert.equal(dateTime.getHours(), 9);
    assert.equal(dateTime.getMinutes(), 30);

    assert.equal(parseCalendarDate('not-a-date'), null);
    assert.equal(parseCalendarDate(null), null);
});

test('normalizeEvents converts strings to dates and drops invalid entries', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();

    const events = normalizeEvents([
        { id: 'a', start: '20260101', end: '20260103', allDay: true },
        { id: 'b', start: 'garbage', end: '20260103' },
        { id: 'c', start: new Date(2026, 5, 1, 9), end: new Date(2026, 5, 1, 10) }
    ]);

    assert.equal(events.length, 2);
    assert.equal(events[0].id, 'a');
    assert.equal(events[0].isAllDay, true);
    assert.ok(events[0].start instanceof Date);
    assert.equal(events[1].id, 'c');
    assert.equal(events[1].isAllDay, false);
});
