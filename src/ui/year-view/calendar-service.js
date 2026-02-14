// Minimal ical parsing for DTSTART/DTEND values returned by Thunderbird's calendar API.
const ENABLE_DUMMY_CALENDARS = true;
const DUMMY_CALENDARS = [
    { id: "dummy-work", name: "Work", color: "#0ea5e9" },
    { id: "dummy-personal", name: "Personal", color: "#22c55e" },
    { id: "dummy-project", name: "Project X", color: "#f97316" }
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
    if (ENABLE_DUMMY_CALENDARS) {
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
    if (ENABLE_DUMMY_CALENDARS) {
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
