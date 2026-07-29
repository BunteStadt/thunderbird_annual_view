export class CalendarProvider {
    async fetchCalendars() {
        throw new Error("Not implemented");
    }

    async fetchCalendarEvents() {
        throw new Error("Not implemented");
    }
}

export function resolveCalendarAllDayOnly(calendarId, options = {}) {
    const { allDayOnly = false, calendarAllDayModes = {} } = options;
    const mode = calendarAllDayModes?.[calendarId];
    if (mode === "yes") return true;
    if (mode === "no") return false;
    return allDayOnly;
}

export class EmptyCalendarProvider extends CalendarProvider {
    async fetchCalendars() {
        return [];
    }

    async fetchCalendarEvents() {
        return [];
    }
}