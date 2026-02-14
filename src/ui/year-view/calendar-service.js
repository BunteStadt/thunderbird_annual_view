// Minimal ical parsing for DTSTART/DTEND values returned by Thunderbird's calendar API.
// Dummy calendars are controlled by globalThis.ENABLE_DUMMY_CALENDARS in main.js
const DUMMY_CALENDARS = [
    { id: "dummy-work", name: "Work", color: "#0ea5e9" },
    { id: "dummy-personal", name: "Personal", color: "#22c55e" },
    { id: "dummy-project", name: "Project X", color: "#f97316" },
    { id: "dummy-holidays", name: "Holidays", color: "#ef4444" }
];

function hasCalendarApi() {
    return !!globalThis.browser?.calendar?.calendars?.query && !!globalThis.browser?.calendar?.items?.query;
}

function getDummyCalendars() {
    return DUMMY_CALENDARS.map((calendar) => ({ ...calendar }));
}

function getDummyEvents(year, options = {}) {
    const { calendarIds = [], allDayOnly = false } = options;
    const calendars = getDummyCalendars().filter((calendar) => !calendarIds.length || calendarIds.includes(calendar.id));
    const events = [
        {
            id: `dummy-${year}-1`,
            calendarId: "dummy-work",
            title: "Design review",
            start: new Date(year, 1, 12, 9, 0, 0),
            end: new Date(year, 1, 12, 13, 30, 0),
            allDay: false
        },
        {
            id: `dummy-${year}-2`,
            calendarId: "dummy-work",
            title: "Release freeze",
            start: new Date(year, 2, 4),
            end: new Date(year, 2, 8),
            allDay: true
        },
        {
            id: `dummy-${year}-3`,
            calendarId: "dummy-personal",
            title: "Summer vacation",
            start: new Date(year, 6, 8),
            end: new Date(year, 6, 23),
            allDay: true
        },
        {
            id: `dummy-${year}-4`,
            calendarId: "dummy-project",
            title: "Project rollout window",
            start: new Date(year, 9, 3),
            end: new Date(year, 9, 29),
            allDay: true
        },
        {
            id: `dummy-${year}-5`,
            calendarId: "dummy-project",
            title: "Incident response drill",
            start: new Date(year, 10, 20, 18, 0, 0),
            end: new Date(year, 10, 21, 2, 0, 0),
            allDay: false
        },
        {
            id: `dummy-${year}-6`,
            calendarId: "dummy-personal",
            title: "Year handover",
            start: new Date(year - 1, 11, 29),
            end: new Date(year, 0, 10),
            allDay: true
        },
        {
            id: `dummy-${year}-7`,
            calendarId: "dummy-work",
            title: "Team building",
            start: new Date(year, 2, 15),
            end: new Date(year, 2, 18),
            allDay: true
        },
        {
            id: `dummy-${year}-8`,
            calendarId: "dummy-personal",
            title: "Family reunion",
            start: new Date(year, 3, 20),
            end: new Date(year, 3, 23),
            allDay: true
        },
        {
            id: `dummy-${year}-9`,
            calendarId: "dummy-project",
            title: "Beta testing",
            start: new Date(year, 4, 10),
            end: new Date(year, 4, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-10`,
            calendarId: "dummy-holidays",
            title: "Christmas break",
            start: new Date(year, 11, 24),
            end: new Date(year, 11, 27),
            allDay: true
        },
        {
            id: `dummy-${year}-11`,
            calendarId: "dummy-holidays",
            title: "New Year",
            start: new Date(year, 11, 31),
            end: new Date(year + 1, 0, 3),
            allDay: true
        },
        // Multi-week events for Work
        {
            id: `dummy-${year}-12`,
            calendarId: "dummy-work",
            title: "Quarterly planning",
            start: new Date(year, 4, 5),
            end: new Date(year, 4, 20),
            allDay: true
        },
        {
            id: `dummy-${year}-13`,
            calendarId: "dummy-work",
            title: "Client workshops",
            start: new Date(year, 6, 7),
            end: new Date(year, 6, 22),
            allDay: true
        },
        {
            id: `dummy-${year}-14`,
            calendarId: "dummy-work",
            title: "Performance reviews",
            start: new Date(year, 8, 1),
            end: new Date(year, 8, 16),
            allDay: true
        },
        // Multi-week events for Personal
        {
            id: `dummy-${year}-15`,
            calendarId: "dummy-personal",
            title: "Extended family visit",
            start: new Date(year, 4, 10),
            end: new Date(year, 4, 25),
            allDay: true
        },
        {
            id: `dummy-${year}-16`,
            calendarId: "dummy-personal",
            title: "Home renovation",
            start: new Date(year, 7, 1),
            end: new Date(year, 7, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-17`,
            calendarId: "dummy-personal",
            title: "Thanksgiving prep",
            start: new Date(year, 10, 1),
            end: new Date(year, 10, 16),
            allDay: true
        },
        // Multi-week events for Project
        {
            id: `dummy-${year}-18`,
            calendarId: "dummy-project",
            title: "Development sprint",
            start: new Date(year, 5, 1),
            end: new Date(year, 5, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-19`,
            calendarId: "dummy-project",
            title: "User testing phase",
            start: new Date(year, 4, 15),
            end: new Date(year, 4, 30),
            allDay: true
        },
        {
            id: `dummy-${year}-20`,
            calendarId: "dummy-project",
            title: "Launch preparation",
            start: new Date(year, 9, 1),
            end: new Date(year, 9, 16),
            allDay: true
        },
        // Multi-week events for Holidays
        {
            id: `dummy-${year}-21`,
            calendarId: "dummy-holidays",
            title: "Spring break",
            start: new Date(year, 3, 1),
            end: new Date(year, 3, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-22`,
            calendarId: "dummy-holidays",
            title: "Memorial Day weekend",
            start: new Date(year, 4, 20),
            end: new Date(year, 5, 4),
            allDay: true
        },
        {
            id: `dummy-${year}-23`,
            calendarId: "dummy-holidays",
            title: "Thanksgiving week",
            start: new Date(year, 10, 20),
            end: new Date(year, 11, 1),
            allDay: true
        }
    ];

    return events
        .filter((event) => calendars.some((calendar) => calendar.id === event.calendarId))
        .filter((event) => !allDayOnly || event.allDay)
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
    if (!hh) {
        return new Date(Number(y), Number(mo) - 1, Number(d));
    }
    const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? "Z" : ""}`;
    return new Date(iso);
}

function formatRangeBound(year, month, day) {
    const yyyy = String(year).padStart(4, "0");
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
}

export async function fetchCalendars() {
    if (globalThis.ENABLE_DUMMY_CALENDARS) {
        return getDummyCalendars();
    }
    if (!hasCalendarApi()) {
        console.log("[fetchCalendars] browser.calendar API unavailable; returning no calendars");
        return [];
    }
    try {
        const calendars = await browser.calendar.calendars.query({});
        return (calendars || []).map((c) => ({
            id: c.id,
            name: c.name || "(unnamed)",
            color: c.color || c.backgroundColor || null
        }));
    } catch (err) {
        console.error("[fetchCalendars] failed", err);
        return [];
    }
}

export async function fetchCalendarEvents(year, options = {}) {
    if (globalThis.ENABLE_DUMMY_CALENDARS) {
        return getDummyEvents(year, options);
    }
    if (!hasCalendarApi()) {
        console.log("[fetchCalendarEvents] browser.calendar API unavailable; returning no events");
        return [];
    }
    const { calendarIds = [], allDayOnly = false } = options;
    const started = Date.now();
    const events = [];
    const rangeStart = formatRangeBound(year, 1, 1);
    const rangeEnd = formatRangeBound(year, 12, 31);

    let calendars = [];
    try {
        calendars = await browser.calendar.calendars.query({});
    } catch (err) {
        console.error("[fetchCalendarEvents] unable to read calendars", err);
        return [];
    }

    for (const cal of calendars) {
        if (calendarIds.length && !calendarIds.includes(cal.id)) {
            continue;
        }

        let items = [];
        try {
            items = await browser.calendar.items.query({
                calendarId: cal.id,
                type: "event",
                returnFormat: "ical",
                expand: true,
                rangeStart,
                rangeEnd
            });
        } catch (err) {
            console.error("[fetchCalendarEvents] query failed", { calendar: cal.name, err });
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
                    title: summary || "(untitled)",
                    start,
                    end,
                    allDay,
                    description,
                    location,
                    calendarName: cal.name,
                    calendarColor: cal.color || cal.backgroundColor || null
                };
            })
            .filter(Boolean);

        parsed.forEach((evt) => {
            const startsInYear = evt.start.getFullYear() === year;
            const endsInYear = evt.end.getFullYear() === year;
            const spansYear = evt.start.getFullYear() < year && evt.end.getFullYear() > year;
            if (allDayOnly && !evt.allDay) {
                return;
            }
            if (startsInYear || endsInYear || spansYear) {
                events.push(evt);
            }
        });
    }

    console.log("[fetchCalendarEvents] done", { total: events.length, ms: Date.now() - started });
    return events;
}
