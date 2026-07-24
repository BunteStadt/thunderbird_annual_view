import { resolveCalendarAllDayOnly } from "../../core/src/index.mjs";

const DUMMY_CALENDARS = [
    { id: "dummy-work", name: "Work", color: "#0ea5e9" },
    { id: "dummy-personal", name: "Personal", color: "#22c55e" },
    { id: "dummy-project", name: "Project X", color: "#f97316" },
    { id: "dummy-holidays", name: "Holidays", color: "#ef4444" }
];

function hasCalendarApi(browserApi) {
    return !!browserApi?.calendar?.calendars?.query && !!browserApi?.calendar?.items?.query;
}

function getDummyCalendars() {
    return DUMMY_CALENDARS.map((calendar) => ({ ...calendar }));
}

function getDummyEventsForAnchorYear(year) {
    return [
        { id: `dummy-${year}-1`, calendarId: "dummy-work", title: "Design review", start: new Date(year, 1, 12, 9, 0, 0), end: new Date(year, 1, 12, 13, 30, 0), allDay: false },
        { id: `dummy-${year}-2`, calendarId: "dummy-work", title: "Release freeze", start: new Date(year, 2, 4), end: new Date(year, 2, 8), allDay: true },
        { id: `dummy-${year}-3`, calendarId: "dummy-personal", title: "Summer vacation", start: new Date(year, 6, 8), end: new Date(year, 6, 23), allDay: true },
        { id: `dummy-${year}-4`, calendarId: "dummy-project", title: "Project rollout window", start: new Date(year, 9, 3), end: new Date(year, 9, 29), allDay: true },
        { id: `dummy-${year}-5`, calendarId: "dummy-project", title: "Incident response drill", start: new Date(year, 10, 20, 18, 0, 0), end: new Date(year, 10, 21, 2, 0, 0), allDay: false },
        { id: `dummy-${year}-6`, calendarId: "dummy-personal", title: "Year handover", start: new Date(year - 1, 11, 29), end: new Date(year, 0, 10), allDay: true },
        { id: `dummy-${year}-7`, calendarId: "dummy-work", title: "Team building", start: new Date(year, 2, 15), end: new Date(year, 2, 18), allDay: true },
        { id: `dummy-${year}-8`, calendarId: "dummy-personal", title: "Family reunion", start: new Date(year, 3, 20), end: new Date(year, 3, 23), allDay: true },
        { id: `dummy-${year}-9`, calendarId: "dummy-project", title: "Beta testing", start: new Date(year, 4, 10), end: new Date(year, 4, 16), allDay: true },
        { id: `dummy-${year}-10`, calendarId: "dummy-holidays", title: "Christmas break", start: new Date(year, 11, 24), end: new Date(year, 11, 27), allDay: true },
        { id: `dummy-${year}-11`, calendarId: "dummy-holidays", title: "New Year", start: new Date(year, 11, 31), end: new Date(year + 1, 0, 3), allDay: true }
    ];
}

function getDummyEvents(year, options = {}) {
    const { calendarIds = [] } = options;
    const calendars = getDummyCalendars().filter((calendar) => !calendarIds.length || calendarIds.includes(calendar.id));

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const events = [year - 1, year, year + 1]
        .flatMap((anchorYear) => getDummyEventsForAnchorYear(anchorYear))
        .filter((event) => event.start < yearEnd && event.end >= yearStart);

    return events
        .filter((event) => calendars.some((calendar) => calendar.id === event.calendarId))
        .filter((event) => !resolveCalendarAllDayOnly(event.calendarId, options) || event.allDay)
        .map((event) => {
            const calendar = calendars.find((item) => item.id === event.calendarId);
            return {
                ...event,
                calendarName: calendar?.name || "(unnamed)",
                calendarColor: calendar?.color || null
            };
        });
}

function parseICalDate(value) {
    if (!value) return null;
    const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    const [, y, mo, d, hh, mm, ss, z] = m;
    if (!hh) return new Date(Number(y), Number(mo) - 1, Number(d));
    const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? "Z" : ""}`;
    return new Date(iso);
}

function formatRangeBound(year, month, day) {
    return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

export function createThunderbirdProvider({ browserApi = globalThis.browser, useDummyData = false } = {}) {
    return {
        id: "thunderbird",
        async fetchCalendars() {
            if (useDummyData) return getDummyCalendars();
            if (!hasCalendarApi(browserApi)) {
                console.log("[fetchCalendars] browser.calendar API unavailable; returning no calendars");
                return [];
            }

            try {
                const calendars = await browserApi.calendar.calendars.query({});
                return (calendars || []).map((calendar) => ({
                    id: calendar.id,
                    name: calendar.name || "(unnamed)",
                    color: calendar.color || calendar.backgroundColor || null
                }));
            } catch (err) {
                console.error("[fetchCalendars] failed", err);
                return [];
            }
        },

        async fetchEvents(year, options = {}) {
            if (useDummyData) return getDummyEvents(year, options);
            if (!hasCalendarApi(browserApi)) {
                console.log("[fetchCalendarEvents] browser.calendar API unavailable; returning no events");
                return [];
            }

            const { calendarIds = [] } = options;
            const events = [];
            const rangeStart = formatRangeBound(year, 1, 1);
            const rangeEnd = formatRangeBound(year, 12, 31);

            let calendars = [];
            try {
                calendars = await browserApi.calendar.calendars.query({});
            } catch (err) {
                console.error("[fetchCalendarEvents] unable to read calendars", err);
                return [];
            }

            for (const calendar of calendars) {
                if (calendarIds.length && !calendarIds.includes(calendar.id)) continue;

                let items = [];
                try {
                    items = await browserApi.calendar.items.query({
                        calendarId: calendar.id,
                        type: "event",
                        returnFormat: "ical",
                        expand: true,
                        rangeStart,
                        rangeEnd
                    });
                } catch (err) {
                    console.error("[fetchCalendarEvents] query failed", { calendar: calendar.name, err });
                    continue;
                }

                const parsed = (items || [])
                    .map(({ id, item }) => {
                        const veventMatch = item.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/m);
                        const vevent = veventMatch ? veventMatch[0] : item;
                        const summary = vevent.match(/^SUMMARY:(.*)$/m)?.[1]?.trim() ?? "";
                        const description = vevent.match(/^DESCRIPTION:(.*)$/m)?.[1]?.trim() ?? "";
                        const location = vevent.match(/^LOCATION:(.*)$/m)?.[1]?.trim() ?? "";
                        const startRaw = vevent.match(/DTSTART(?:;TZID=[^:]+|;VALUE=DATE)?:([^\r\n]+)/m)?.[1];
                        const endRaw = vevent.match(/DTEND(?:;TZID=[^:]+|;VALUE=DATE)?:([^\r\n]+)/m)?.[1];
                        const start = parseICalDate(startRaw);
                        const end = parseICalDate(endRaw);
                        if (!(start instanceof Date) || Number.isNaN(start)) return null;
                        if (!(end instanceof Date) || Number.isNaN(end)) return null;
                        const allDay = !!startRaw && !startRaw.includes("T");
                        return {
                            id,
                            calendarId: calendar.id,
                            title: summary || "(untitled)",
                            start,
                            end,
                            allDay,
                            description,
                            location,
                            calendarName: calendar.name,
                            calendarColor: calendar.color || calendar.backgroundColor || null
                        };
                    })
                    .filter(Boolean);

                parsed.forEach((event) => {
                    const startsInYear = event.start.getFullYear() === year;
                    const endsInYear = event.end.getFullYear() === year;
                    const spansYear = event.start.getFullYear() < year && event.end.getFullYear() > year;
                    if (resolveCalendarAllDayOnly(calendar.id, options) && !event.allDay) return;
                    if (startsInYear || endsInYear || spansYear) events.push(event);
                });
            }

            return events;
        }
    };
}
