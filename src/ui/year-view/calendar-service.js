import { CalendarProvider, EmptyCalendarProvider } from "./calendar-provider.js";
import { DummyCalendarProvider } from "./dummy-calendar-provider.js";
import { GoogleCalendarProvider } from "./google-calendar-provider.js";
import { ThunderbirdCalendarProvider } from "./thunderbird-calendar-provider.js";

let activeCalendarProvider = null;

export {
    CalendarProvider,
    DummyCalendarProvider,
    EmptyCalendarProvider,
    GoogleCalendarProvider,
    ThunderbirdCalendarProvider
};

export function setCalendarProvider(provider) {
    activeCalendarProvider = provider ?? null;
}

export function getCalendarProvider() {
    return activeCalendarProvider || createDefaultCalendarProvider();
}

export function createDefaultCalendarProvider() {
    if (globalThis.ENABLE_DUMMY_CALENDARS) {
        return new DummyCalendarProvider();
    }

    if (globalThis.ENABLE_GOOGLE_CALENDARS) {
        return new GoogleCalendarProvider();
    }

    if (globalThis.browser?.calendar?.calendars?.query && globalThis.browser?.calendar?.items?.query) {
        return new ThunderbirdCalendarProvider();
    }

    return new EmptyCalendarProvider();
}

export async function fetchCalendars() {
    return getCalendarProvider().fetchCalendars();
}

export async function fetchCalendarEvents(year, options = {}) {
    return getCalendarProvider().fetchCalendarEvents(year, options);
}
