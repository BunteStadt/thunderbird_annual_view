import { CalendarProvider, EmptyCalendarProvider } from "./calendar-provider.js";
import { DummyCalendarProvider } from "./dummy-calendar-provider.js";
import { GoogleCalendarProvider } from "./google-calendar-provider.js";
import { IcsCalendarProvider } from "./ics-calendar-provider.js";

let activeCalendarProvider = null;
let activeIcsProvider = new IcsCalendarProvider([]);

export {
    CalendarProvider,
    DummyCalendarProvider,
    EmptyCalendarProvider,
    GoogleCalendarProvider,
    IcsCalendarProvider
};

// Host-registered provider factories (e.g. the Thunderbird host registers its
// experiment-API provider here so the core never imports host code).
const providerFactories = new Map();

export function registerProviderFactory(kind, factory) {
    providerFactories.set(kind, factory);
}

export function setCalendarProvider(provider) {
    activeCalendarProvider = provider ?? null;
}

export function getCalendarProvider() {
    return activeCalendarProvider || new EmptyCalendarProvider();
}

export function setIcsCalendars(calendars) {
    activeIcsProvider = new IcsCalendarProvider(calendars);
}

export function createCalendarProvider(kind) {
    const factory = providerFactories.get(kind);
    if (factory) {
        return factory();
    }
    switch (kind) {
        case "dummy":
            return new DummyCalendarProvider();
        case "google":
            return new GoogleCalendarProvider();
        default:
            return new EmptyCalendarProvider();
    }
}

export async function fetchCalendars() {
    const [mainCalendars, icsCalendars] = await Promise.all([
        getCalendarProvider().fetchCalendars(),
        activeIcsProvider.fetchCalendars()
    ]);
    return [...mainCalendars, ...icsCalendars];
}

export async function fetchCalendarEvents(year, options = {}) {
    const [mainEvents, icsEvents] = await Promise.all([
        getCalendarProvider().fetchCalendarEvents(year, options),
        activeIcsProvider.fetchCalendarEvents(year, options)
    ]);
    return [...mainEvents, ...icsEvents];
}
