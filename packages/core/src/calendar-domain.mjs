export function resolveCalendarAllDayOnly(calendarId, options = {}) {
    const { allDayOnly = false, calendarAllDayModes = {} } = options;
    const mode = calendarAllDayModes?.[calendarId];
    if (mode === "yes") return true;
    if (mode === "no") return false;
    return allDayOnly;
}

export function dedupeEventsByIdentity(events = []) {
    const seen = new Set();
    const deduped = [];

    for (const event of events) {
        const key = `${event.id ?? `${event.calendarId}|${event.title}`}|${event.start?.getTime?.()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(event);
    }

    return deduped;
}

export function filterEventsByDisplayFilters(events = [], filters = {}) {
    const {
        calendarIds = [],
        allDayOnly = false,
        calendarAllDayModes = {},
        getMinDurationMs = () => 0,
        eventDurationMs = () => 0
    } = filters;

    if (!calendarIds.length) {
        return { events: [], stats: { filteredOut: 0, total: 0 } };
    }

    const wanted = new Set(calendarIds);
    const candidates = events.filter((event) => wanted.has(event.calendarId));
    const visible = candidates.filter((event) => {
        if (resolveCalendarAllDayOnly(event.calendarId, { allDayOnly, calendarAllDayModes }) && !event.isAllDay) {
            return false;
        }
        return eventDurationMs(event) >= getMinDurationMs(event.calendarId);
    });

    return {
        events: visible,
        stats: {
            filteredOut: candidates.length - visible.length,
            total: candidates.length
        }
    };
}

export function buildCalendarSummary(events = []) {
    const total = events.length;
    const byCalendar = new Map();

    for (const event of events) {
        const key = event.calendarId || "unknown";
        byCalendar.set(key, (byCalendar.get(key) || 0) + 1);
    }

    return {
        total,
        calendars: Array.from(byCalendar.entries()).map(([calendarId, count]) => ({ calendarId, count }))
    };
}
