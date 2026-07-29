import { CalendarProvider } from "./calendar-provider.js";
import { parseCalendarDate } from "./date-utils.js";

// Removes iCalendar line folding (RFC 5545 §3.1): any CRLF or LF followed
// by a single whitespace character is a continuation of the preceding line.
function unfoldLines(text) {
    return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

// Extracts the property value from an unfolded iCal property line.
// Returns the text after the first colon, stripping any surrounding whitespace.
function extractValue(line) {
    const colonIndex = line.indexOf(":");
    return colonIndex === -1 ? "" : line.slice(colonIndex + 1).trim();
}

// Parses a raw iCal date string into a JavaScript Date.
// Extends parseCalendarDate to also handle the UTC variant YYYYMMDDTHHMMSSZ.
function parseIcsDate(raw) {
    if (!raw) return null;
    const utcMatch = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (utcMatch) {
        const [, y, mo, d, hh, mm, ss] = utcMatch;
        return new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`);
    }
    return parseCalendarDate(raw);
}

// Returns true when the DTSTART property line indicates an all-day event
// (i.e. the value has no time component: either VALUE=DATE qualifier or a
// plain 8-digit date string).
function isAllDayLine(dtStartLine) {
    if (!dtStartLine) return false;
    if (/VALUE=DATE/i.test(dtStartLine)) return true;
    const value = extractValue(dtStartLine);
    return /^\d{8}$/.test(value);
}

// Returns the raw date string from a DTSTART or DTEND property line,
// stripping any TZID or VALUE parameters.
function extractDateValue(line) {
    if (!line) return null;
    return extractValue(line);
}

// Parses all VEVENT blocks from unfolded iCal text and returns a flat array
// of raw event objects.  Each object carries the properties needed by the
// annual-view domain: id, title, start, end, allDay, description, location.
function parseVEvents(unfoldedText) {
    const events = [];
    const veventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;
    while ((match = veventRe.exec(unfoldedText)) !== null) {
        const block = match[1];
        const lines = block.split(/\r?\n/);

        let uid = "";
        let summary = "";
        let description = "";
        let location = "";
        let dtStartLine = null;
        let dtEndLine = null;

        for (const line of lines) {
            const upper = line.toUpperCase();
            if (upper.startsWith("UID:")) {
                uid = extractValue(line);
            } else if (upper.startsWith("SUMMARY:")) {
                summary = extractValue(line);
            } else if (upper.startsWith("DESCRIPTION:")) {
                description = extractValue(line);
            } else if (upper.startsWith("LOCATION:")) {
                location = extractValue(line);
            } else if (/^DTSTART[;:]/.test(upper)) {
                dtStartLine = line;
            } else if (/^DTEND[;:]/.test(upper)) {
                dtEndLine = line;
            }
        }

        const startRaw = extractDateValue(dtStartLine);
        const endRaw = extractDateValue(dtEndLine);
        const start = parseIcsDate(startRaw);
        const end = parseIcsDate(endRaw);

        if (!(start instanceof Date) || Number.isNaN(start.getTime())) continue;
        if (!(end instanceof Date) || Number.isNaN(end.getTime())) continue;

        events.push({
            id: uid || null,
            title: summary || "(untitled)",
            start,
            end,
            allDay: isAllDayLine(dtStartLine),
            description,
            location
        });
    }
    return events;
}

function resolveCalendarAllDayOnly(calendarId, options = {}) {
    const { allDayOnly = false, calendarAllDayModes = {} } = options;
    const mode = calendarAllDayModes?.[calendarId];
    if (mode === "yes") return true;
    if (mode === "no") return false;
    return allDayOnly;
}

/**
 * A CalendarProvider that reads events from in-memory ICS content.
 *
 * Construct with an array of calendar descriptors:
 *   { id, name, color, content }
 * where `content` is the raw text of an iCalendar (.ics) file.
 *
 * This provider is platform-agnostic: it does not perform any I/O itself.
 * The caller is responsible for loading the ICS text (e.g. via fetch or
 * fs.readFile) and passing it in at construction time.
 */
export class IcsCalendarProvider extends CalendarProvider {
    constructor(calendars = []) {
        super();
        // Eagerly parse each ICS payload so fetchCalendarEvents is synchronous.
        this._calendars = calendars.map((cal) => ({
            id: cal.id,
            name: cal.name || "(unnamed)",
            color: cal.color || null,
            events: parseVEvents(unfoldLines(cal.content || ""))
        }));
    }

    hasCalendars() {
        return this._calendars.length > 0;
    }

    async fetchCalendars() {
        return this._calendars.map(({ id, name, color }) => ({ id, name, color }));
    }

    async fetchCalendarEvents(year, options = {}) {
        const { calendarIds = [] } = options;
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);

        const results = [];

        for (const cal of this._calendars) {
            if (calendarIds.length && !calendarIds.includes(cal.id)) {
                continue;
            }

            for (const event of cal.events) {
                const startsInYear = event.start >= yearStart && event.start < yearEnd;
                const endsInYear = event.end > yearStart && event.end <= yearEnd;
                const spansYear = event.start < yearStart && event.end >= yearEnd;

                if (!startsInYear && !endsInYear && !spansYear) {
                    continue;
                }

                if (resolveCalendarAllDayOnly(cal.id, options) && !event.allDay) {
                    continue;
                }

                results.push({
                    ...event,
                    calendarId: cal.id,
                    calendarName: cal.name,
                    calendarColor: cal.color
                });
            }
        }

        return results;
    }
}
