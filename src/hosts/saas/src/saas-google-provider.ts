import { resolveCalendarAllDayOnly } from "../../../core/providers/calendar-provider.js";

type GetToken = () => Promise<string | null>;

type CalendarSummary = {
    id: string;
    name: string;
    color: string;
};

type CalendarEventResponse = {
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

type CalendarListResponse = { calendars?: CalendarSummary[] };
type EventsResponse = { events?: CalendarEventResponse[] };
type EventOptions = {
    calendarIds?: string[];
    allDayOnly?: boolean;
    calendarAllDayModes?: Record<string, string>;
};

function parseEventDate(value: string, allDay: boolean): Date {
    if (allDay && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const [year, month, day] = value.slice(0, 10).split("-").map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(value);
}

export function createSaasGoogleProvider(getToken: GetToken) {
    return new SaasGoogleCalendarProvider(getToken);
}

class SaasGoogleCalendarProvider {
    private connected = false;
    private readonly getToken: GetToken;

    constructor(getToken: GetToken) {
        this.getToken = getToken;
    }

    getAuthState() {
        return { configured: true, authenticated: this.connected };
    }

    async signIn() {
        const result = await this.request<CalendarListResponse>("/api/google/calendars");
        this.connected = true;
        return { authenticated: true, calendars: result.calendars || [] };
    }

    async signOut() {
        this.connected = false;
    }

    async fetchCalendars(): Promise<CalendarSummary[]> {
        try {
            const result = await this.request<CalendarListResponse>("/api/google/calendars");
            this.connected = true;
            return result.calendars || [];
        } catch (error) {
            console.error("[SaasGoogleCalendarProvider] fetchCalendars failed", error);
            return [];
        }
    }

    async fetchCalendarEvents(year: number, options: EventOptions = {}) {
        try {
            const calendarIds = options.calendarIds || [];
            const query = new URLSearchParams({ year: String(year) });
            calendarIds.forEach((calendarId) => query.append("calendarId", calendarId));
            const result = await this.request<EventsResponse>(`/api/google/events?${query}`);
            this.connected = true;
            return (result.events || []).filter((event) => {
                return !resolveCalendarAllDayOnly(event.calendarId, options) || event.allDay;
            }).map((event) => ({
                ...event,
                start: parseEventDate(event.start, event.allDay),
                end: parseEventDate(event.end, event.allDay)
            }));
        } catch (error) {
            console.error("[SaasGoogleCalendarProvider] fetchCalendarEvents failed", error);
            return [];
        }
    }

    private async request<T>(path: string): Promise<T> {
        const token = await this.getToken();
        if (!token) throw new Error("Not authenticated with Clerk.");
        const response = await fetch(path, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error(`Worker Google Calendar request failed (${response.status})`);
        }
        return response.json<T>();
    }
}
