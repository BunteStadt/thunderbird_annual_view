import { CalendarProvider, resolveCalendarAllDayOnly } from "../../core/providers/calendar-provider.js";

function hasThunderbirdCalendarApi() {
    return !!globalThis.browser?.calendar?.calendars?.query && !!globalThis.browser?.calendar?.items?.query;
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

export class ThunderbirdCalendarProvider extends CalendarProvider {
    async fetchCalendars() {
        if (!hasThunderbirdCalendarApi()) {
            return [];
        }

        try {
            const calendars = await browser.calendar.calendars.query({});
            const result = (calendars || []).map((calendar) => ({
                id: calendar.id,
                name: calendar.name || "(unnamed)",
                color: calendar.color || calendar.backgroundColor || null
            }));
            console.log("[ThunderbirdCalendarProvider] calendars found:", result.map(c => c.name).join(", "));
            return result;
        } catch (err) {
            console.error("[ThunderbirdCalendarProvider] fetchCalendars failed", err);
            return [];
        }
    }

    async fetchCalendarEvents(year, options = {}) {
        if (!hasThunderbirdCalendarApi()) {
            return [];
        }

        const { calendarIds = [] } = options;
        const started = Date.now();
        const events = [];
        const rangeStart = formatRangeBound(year, 1, 1);
        const rangeEnd = formatRangeBound(year, 12, 31);

        let calendars = [];
        try {
            calendars = await browser.calendar.calendars.query({});
        } catch (err) {
            console.error("[ThunderbirdCalendarProvider] unable to read calendars", err);
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
                console.error("[ThunderbirdCalendarProvider] query failed", { calendar: cal.name, err });
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
                        calendarId: cal.id,
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

            parsed.forEach((event) => {
                const startsInYear = event.start.getFullYear() === year;
                const endsInYear = event.end.getFullYear() === year;
                const spansYear = event.start.getFullYear() < year && event.end.getFullYear() > year;
                if (resolveCalendarAllDayOnly(cal.id, options) && !event.allDay) {
                    return;
                }
                if (startsInYear || endsInYear || spansYear) {
                    events.push(event);
                }
            });
            console.log("[ThunderbirdCalendarProvider] calendar loaded:", { calendar: cal.name, events: parsed.length });
        }

        console.log("[ThunderbirdCalendarProvider] done", { total: events.length, ms: Date.now() - started });
        return events;
    }
}