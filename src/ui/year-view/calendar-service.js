import { CalendarProvider, EmptyCalendarProvider } from "./calendar-provider.js";
import { DummyCalendarProvider } from "./dummy-calendar-provider.js";
import { GoogleCalendarProvider } from "./google-calendar-provider.js";
import { IcsCalendarProvider } from "./ics-calendar-provider.js";
import { ThunderbirdCalendarProvider } from "./thunderbird-calendar-provider.js";

let activeCalendarProvider = null;
let activeIcsProvider = new IcsCalendarProvider([]);

export {
    CalendarProvider,
    DummyCalendarProvider,
    EmptyCalendarProvider,
    GoogleCalendarProvider,
    IcsCalendarProvider,
    ThunderbirdCalendarProvider
};

export function setCalendarProvider(provider) {
    activeCalendarProvider = provider ?? null;
}

export function getCalendarProvider() {
    if (activeCalendarProvider) {
        return activeCalendarProvider;
    }

    if (activeIcsProvider.hasCalendars()) {
        return activeIcsProvider;
    }

    return createDefaultCalendarProvider();
}

export function setIcsCalendars(calendars) {
    activeIcsProvider = new IcsCalendarProvider(calendars);
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
