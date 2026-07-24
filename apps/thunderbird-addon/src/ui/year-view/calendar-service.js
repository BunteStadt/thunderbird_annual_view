import { createThunderbirdProvider } from "../../../../../packages/provider-adapters/src/index.mjs";

function getProvider() {
    return createThunderbirdProvider({
        browserApi: globalThis.browser,
        useDummyData: !!globalThis.ENABLE_DUMMY_CALENDARS
    });
}

export async function fetchCalendars() {
    return getProvider().fetchCalendars();
}

export async function fetchCalendarEvents(year, options = {}) {
    const started = Date.now();
    const events = await getProvider().fetchEvents(year, options);
    console.log("[fetchCalendarEvents] done", { total: events.length, ms: Date.now() - started });
    return events;
}
