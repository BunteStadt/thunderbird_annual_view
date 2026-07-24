// Shared date and event-shape helpers used by the grid renderer and event store.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];

export function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

// Days since the Unix epoch for the *local* calendar date of `date`.
// Using Date.UTC on the local components keeps day arithmetic DST-safe.
export function dayNumber(date) {
    return Math.trunc(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

// Inverse of dayNumber: returns a local Date at midnight for the given day number.
export function dateFromDayNumber(dayNum) {
    const utc = new Date(dayNum * MS_PER_DAY);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

export function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / MS_PER_DAY + 1) / 7);
}

export function isAllDayEvent(event) {
    if (event.isAllDay === true || event.allDay === true) return true;
    if (!event.start || !event.end) return false;
    const { start, end } = event;
    const startMidnight = start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0;
    const endMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;
    const fullDays = (end.getTime() - start.getTime()) % MS_PER_DAY === 0;
    return startMidnight && endMidnight && fullDays;
}

// All-day events use an exclusive end date; pull it back one day for display.
export function adjustAllDayEnd(end) {
    const dt = new Date(end.getTime());
    if (dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0) {
        dt.setDate(dt.getDate() - 1);
    }
    return dt;
}

export function eventDurationMs(event) {
    if (!event || !event.start || !event.end) return 0;
    if (isAllDayEvent(event)) {
        const inclusiveEnd = adjustAllDayEnd(event.end);
        return inclusiveEnd.getTime() + MS_PER_DAY - event.start.getTime();
    }
    return event.end.getTime() - event.start.getTime();
}

// Accepts Date objects, iCal date strings (YYYYMMDD / YYYYMMDDTHHMMSS) and ISO strings.
export function parseCalendarDate(value) {
    if (value instanceof Date) return value;
    if (typeof value !== "string") return null;
    const s = value.trim();

    if (/^\d{8}$/.test(s)) {
        return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    }

    if (/^\d{8}T\d{6}$/.test(s)) {
        return new Date(
            Number(s.slice(0, 4)),
            Number(s.slice(4, 6)) - 1,
            Number(s.slice(6, 8)),
            Number(s.slice(9, 11)),
            Number(s.slice(11, 13)),
            Number(s.slice(13, 15))
        );
    }

    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

// Ensures every event has Date instances for start/end plus an isAllDay flag.
export function normalizeEvents(events) {
    return (events || [])
        .map((ev) => {
            const allDay = ev.allDay === true || ev.isAllDay === true;
            const start = parseCalendarDate(ev.start || ev.startDate);
            const end = parseCalendarDate(ev.end || ev.endDate);
            if (!start || !end) return null;
            return { ...ev, start, end, isAllDay: allDay };
        })
        .filter(Boolean);
}
