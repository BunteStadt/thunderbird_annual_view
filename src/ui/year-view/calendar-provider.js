export class CalendarProvider {
    async fetchCalendars() {
        throw new Error("Not implemented");
    }

    async fetchCalendarEvents() {
        throw new Error("Not implemented");
    }
}

export class EmptyCalendarProvider extends CalendarProvider {
    async fetchCalendars() {
        return [];
    }

    async fetchCalendarEvents() {
        return [];
    }
}