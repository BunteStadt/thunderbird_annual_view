const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadDateUtilsModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/date-utils.js');
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

test('daysInMonth returns 31 for January', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2026, 0), 31);
});

test('daysInMonth returns 28 for February in a common year', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2025, 1), 28);
});

test('daysInMonth returns 29 for February in a leap year', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2024, 1), 29);
});

test('daysInMonth returns 30 for April', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2026, 3), 30);
});

test('daysInMonth returns 31 for December', async () => {
    const { daysInMonth } = await loadDateUtilsModule();
    assert.equal(daysInMonth(2026, 11), 31);
});

test('dayNumber increments by one for each day', async () => {
    const { dayNumber } = await loadDateUtilsModule();
    assert.equal(dayNumber(new Date(2026, 0, 2)) - dayNumber(new Date(2026, 0, 1)), 1);
});

test('dayNumber handles leap day correctly', async () => {
    const { dayNumber } = await loadDateUtilsModule();
    assert.equal(dayNumber(new Date(2024, 1, 29)) - dayNumber(new Date(2024, 1, 28)), 1);
});

test('dayNumber changes across the year boundary', async () => {
    const { dayNumber } = await loadDateUtilsModule();
    assert.equal(dayNumber(new Date(2027, 0, 1)) - dayNumber(new Date(2026, 11, 31)), 1);
});

test('dateFromDayNumber returns the expected calendar date', async () => {
    const { dateFromDayNumber, dayNumber } = await loadDateUtilsModule();
    const original = new Date(2026, 6, 14);
    const roundTrip = dateFromDayNumber(dayNumber(original));
    assert.equal(roundTrip.getFullYear(), 2026);
    assert.equal(roundTrip.getMonth(), 6);
    assert.equal(roundTrip.getDate(), 14);
});

test('dateFromDayNumber preserves midnight values', async () => {
    const { dateFromDayNumber } = await loadDateUtilsModule();
    const date = dateFromDayNumber(0);
    assert.equal(date.getFullYear(), 1970);
    assert.equal(date.getMonth(), 0);
    assert.equal(date.getDate(), 1);
});

test('dateFromDayNumber returns the next day for day 1', async () => {
    const { dateFromDayNumber } = await loadDateUtilsModule();
    const date = dateFromDayNumber(1);
    assert.equal(date.getFullYear(), 1970);
    assert.equal(date.getMonth(), 0);
    assert.equal(date.getDate(), 2);
});

test('dateFromDayNumber handles a large day count', async () => {
    const { dateFromDayNumber } = await loadDateUtilsModule();
    const date = dateFromDayNumber(365);
    assert.equal(date.getFullYear(), 1971);
    assert.equal(date.getMonth(), 0);
    assert.equal(date.getDate(), 1);
});

test('getISOWeekNumber returns week 1 for January 1 2026', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2026, 0, 1))), 1);
});

test('getISOWeekNumber returns week 53 for January 1 2027', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2027, 0, 1))), 53);
});

test('getISOWeekNumber returns week 1 for a Monday in early January', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2024, 0, 1))), 1);
});

test('getISOWeekNumber returns week 53 for the last day of 2020', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2020, 11, 31))), 53);
});

test('getISOWeekNumber returns week 1 for December 31 2024', async () => {
    const { getISOWeekNumber } = await loadDateUtilsModule();
    assert.equal(getISOWeekNumber(new Date(Date.UTC(2024, 11, 31))), 1);
});

test('isAllDayEvent treats explicit all-day flags as all-day', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();
    assert.equal(isAllDayEvent({ allDay: true }), true);
});

test('isAllDayEvent treats isAllDay flags as all-day', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();
    assert.equal(isAllDayEvent({ isAllDay: true }), true);
});

test('isAllDayEvent recognizes midnight-aligned multi-day events', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();
    assert.equal(isAllDayEvent({ start: new Date(2026, 0, 1), end: new Date(2026, 0, 3) }), true);
});

test('isAllDayEvent returns false for timed events', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();
    assert.equal(isAllDayEvent({ start: new Date(2026, 0, 1, 9), end: new Date(2026, 0, 1, 17) }), false);
});

test('isAllDayEvent returns false for events without start and end', async () => {
    const { isAllDayEvent } = await loadDateUtilsModule();
    assert.equal(isAllDayEvent({ title: 'No dates' }), false);
});

test('adjustAllDayEnd returns the same date for non-midnight end values', async () => {
    const { adjustAllDayEnd } = await loadDateUtilsModule();
    const end = new Date(2026, 0, 3, 9);
    assert.equal(adjustAllDayEnd(end).getTime(), end.getTime());
});

test('adjustAllDayEnd moves midnight end dates back one day', async () => {
    const { adjustAllDayEnd } = await loadDateUtilsModule();
    const end = new Date(2026, 0, 3);
    const adjusted = adjustAllDayEnd(end);
    assert.equal(adjusted.getFullYear(), 2026);
    assert.equal(adjusted.getMonth(), 0);
    assert.equal(adjusted.getDate(), 2);
});

test('adjustAllDayEnd preserves the time component for a midnight date', async () => {
    const { adjustAllDayEnd } = await loadDateUtilsModule();
    const end = new Date(2026, 0, 3, 0, 0, 0);
    const adjusted = adjustAllDayEnd(end);
    assert.equal(adjusted.getHours(), 0);
    assert.equal(adjusted.getMinutes(), 0);
    assert.equal(adjusted.getSeconds(), 0);
});

test('adjustAllDayEnd returns a new Date instance', async () => {
    const { adjustAllDayEnd } = await loadDateUtilsModule();
    const end = new Date(2026, 0, 3);
    const adjusted = adjustAllDayEnd(end);
    assert.notStrictEqual(adjusted, end);
});

test('adjustAllDayEnd handles a midnight date without mutating the original', async () => {
    const { adjustAllDayEnd } = await loadDateUtilsModule();
    const end = new Date(2026, 0, 3);
    adjustAllDayEnd(end);
    assert.equal(end.getDate(), 3);
});

test('eventDurationMs returns zero for missing dates', async () => {
    const { eventDurationMs } = await loadDateUtilsModule();
    assert.equal(eventDurationMs(null), 0);
});

test('eventDurationMs returns zero for incomplete events', async () => {
    const { eventDurationMs } = await loadDateUtilsModule();
    assert.equal(eventDurationMs({ start: new Date(2026, 0, 1) }), 0);
});

test('eventDurationMs calculates duration for timed events', async () => {
    const { eventDurationMs } = await loadDateUtilsModule();
    const timed = { start: new Date(2026, 0, 1, 9), end: new Date(2026, 0, 1, 13) };
    assert.equal(eventDurationMs(timed), 4 * 60 * 60 * 1000);
});

test('eventDurationMs treats a multi-day all-day event as exclusive end date', async () => {
    const { eventDurationMs, MS_PER_DAY } = await loadDateUtilsModule();
    const allDay = { allDay: true, start: new Date(2026, 0, 1), end: new Date(2026, 0, 3) };
    assert.equal(eventDurationMs(allDay), 2 * MS_PER_DAY);
});

test('eventDurationMs handles a one-day all-day event', async () => {
    const { eventDurationMs, MS_PER_DAY } = await loadDateUtilsModule();
    const allDay = { allDay: true, start: new Date(2026, 0, 1), end: new Date(2026, 0, 2) };
    assert.equal(eventDurationMs(allDay), MS_PER_DAY);
});

test('parseCalendarDate parses YYYYMMDD dates', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();
    const dateOnly = parseCalendarDate('20260714');
    assert.equal(dateOnly.getFullYear(), 2026);
    assert.equal(dateOnly.getMonth(), 6);
    assert.equal(dateOnly.getDate(), 14);
});

test('parseCalendarDate parses YYYYMMDDTHHMMSS dates', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();
    const dateTime = parseCalendarDate('20260714T093000');
    assert.equal(dateTime.getHours(), 9);
    assert.equal(dateTime.getMinutes(), 30);
});

test('parseCalendarDate parses ISO strings', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();
    const iso = parseCalendarDate('2026-07-14T09:30:00Z');
    assert.equal(iso.getUTCFullYear(), 2026);
    assert.equal(iso.getUTCMonth(), 6);
    assert.equal(iso.getUTCDate(), 14);
});

test('parseCalendarDate returns Date objects unchanged', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();
    const input = new Date(2026, 6, 14);
    assert.strictEqual(parseCalendarDate(input), input);
});

test('parseCalendarDate returns null for invalid values', async () => {
    const { parseCalendarDate } = await loadDateUtilsModule();
    assert.equal(parseCalendarDate('not-a-date'), null);
    assert.equal(parseCalendarDate(null), null);
});

test('normalizeEvents converts start and end strings to Dates', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();
    const [event] = normalizeEvents([{ id: 'a', start: '20260101', end: '20260103' }]);
    assert.ok(event.start instanceof Date);
    assert.ok(event.end instanceof Date);
});

test('normalizeEvents uses startDate and endDate when present', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();
    const [event] = normalizeEvents([{ id: 'a', startDate: '20260101', endDate: '20260103' }]);
    assert.ok(event.start instanceof Date);
    assert.ok(event.end instanceof Date);
});

test('normalizeEvents preserves explicit all-day flags', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();
    const [event] = normalizeEvents([{ id: 'a', start: '20260101', end: '20260103', allDay: true }]);
    assert.equal(event.isAllDay, true);
});

test('normalizeEvents preserves isAllDay flags when allDay is absent', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();
    const [event] = normalizeEvents([{ id: 'a', start: '20260101', end: '20260103', isAllDay: true }]);
    assert.equal(event.isAllDay, true);
});

test('normalizeEvents drops invalid rows and handles empty input', async () => {
    const { normalizeEvents } = await loadDateUtilsModule();
    assert.deepEqual(normalizeEvents([]), []);
    assert.deepEqual(normalizeEvents(null), []);
    assert.equal(normalizeEvents([{ id: 'bad', start: 'garbage', end: '20260103' }]).length, 0);
});
