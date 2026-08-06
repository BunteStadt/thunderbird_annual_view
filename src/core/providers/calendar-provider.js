export class CalendarProvider {
    async fetchCalendars() {
        throw new Error("Not implemented");
    }

    async fetchCalendarEvents() {
        throw new Error("Not implemented");
    }
}

function resolveCalendarAllDayOnly(calendarId, options = {}) {
    const { allDayOnly = false, calendarAllDayModes = {} } = options;
    const mode = calendarAllDayModes?.[calendarId];
    if (mode === "yes") return true;
    if (mode === "no") return false;
    return allDayOnly;
}

export { resolveCalendarAllDayOnly };
export function resolveCalendarAllDayOnlyExport(calendarId, options = {}) {
    return resolveCalendarAllDayOnly(calendarId, options);
}

export class EmptyCalendarProvider extends CalendarProvider {
    async fetchCalendars() {
        return [];
    }

    async fetchCalendarEvents() {
        return [];
    }
}