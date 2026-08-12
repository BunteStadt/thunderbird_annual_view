const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const FALLBACK_EVENT_LENGTH_MS = 60 * 60 * 1000;

type GoogleCalendar = {
    id?: string;
    summary?: string;
    backgroundColor?: string;
    foregroundColor?: string;
};

type GoogleEvent = {
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
};

type GoogleListResponse<T> = {
    items?: T[];
    nextPageToken?: string;
};

export type CalendarSummary = {
    id: string;
    name: string;
    color: string;
};

export type CalendarEvent = {
    id: string;
    calendarId: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    description: string;
    location: string;
    calendarName: string;
    calendarColor: string | null;
};

function parseDate(value: string | undefined, allDay: boolean): Date | null {
    if (!value) return null;
    if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapCalendar(calendar: GoogleCalendar): CalendarSummary | null {
    if (!calendar.id) return null;
    return {
        id: calendar.id,
        name: calendar.summary || calendar.id,
        color: calendar.backgroundColor || calendar.foregroundColor || "#0a84ff"
    };
}

function mapEvent(item: GoogleEvent, calendar: CalendarSummary): CalendarEvent | null {
    const allDay = Boolean(item.start?.date && !item.start.dateTime);
    const start = parseDate(item.start?.dateTime || item.start?.date, allDay);
    if (!start) return null;

    let end = parseDate(item.end?.dateTime || item.end?.date, allDay);
    if (!end || end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : FALLBACK_EVENT_LENGTH_MS));
    }

    return {
        id: item.id || `${calendar.id}-${start.getTime()}`,
        calendarId: calendar.id,
        title: item.summary || "(untitled)",
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        description: item.description || "",
        location: item.location || "",
        calendarName: calendar.name,
        calendarColor: calendar.color || null
    };
}

async function googleList<T>(url: URL, accessToken: string): Promise<GoogleListResponse<T>> {
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        console.error(`[google] API request failed status=${response.status}`);
        throw new Error(`Google Calendar API request failed (${response.status})`);
    }
    return response.json<GoogleListResponse<T>>();
}

export async function fetchGoogleCalendars(accessToken: string): Promise<CalendarSummary[]> {
    const calendars: CalendarSummary[] = [];
    let pageToken = "";
    do {
        const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const data = await googleList<GoogleCalendar>(url, accessToken);
        for (const calendar of data.items || []) {
            const mapped = mapCalendar(calendar);
            if (mapped) calendars.push(mapped);
        }
        pageToken = data.nextPageToken || "";
    } while (pageToken);
    return calendars;
}

export async function fetchGoogleEvents(
    accessToken: string,
    year: number,
    calendarIds: string[] = []
): Promise<CalendarEvent[]> {
    const calendars = (await fetchGoogleCalendars(accessToken))
        .filter((calendar) => !calendarIds.length || calendarIds.includes(calendar.id));
    const timeMin = new Date(Date.UTC(year, 0, 1)).toISOString();
    const timeMax = new Date(Date.UTC(year + 1, 0, 1)).toISOString();

    const perCalendar = await Promise.all(calendars.map(async (calendar) => {
        const events: CalendarEvent[] = [];
        let pageToken = "";
        do {
            const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendar.id)}/events`);
            url.searchParams.set("singleEvents", "true");
            url.searchParams.set("orderBy", "startTime");
            url.searchParams.set("timeMin", timeMin);
            url.searchParams.set("timeMax", timeMax);
            url.searchParams.set("maxResults", "2500");
            if (pageToken) url.searchParams.set("pageToken", pageToken);
            const data = await googleList<GoogleEvent>(url, accessToken);
            for (const item of data.items || []) {
                const mapped = mapEvent(item, calendar);
                if (mapped) events.push(mapped);
            }
            pageToken = data.nextPageToken || "";
        } while (pageToken);
        return events;
    }));

    return perCalendar.flat();
}