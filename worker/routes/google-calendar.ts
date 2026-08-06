import { json, methodNotAllowed } from "../shared/http";
import { requireEntitlement } from "../shared/supabase";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const EVENT_PARAMETERS = new Set([
    "singleEvents",
    "orderBy",
    "timeMin",
    "timeMax",
    "maxResults",
    "pageToken"
]);

function upstreamUrl(url: URL): URL | null {
    if (url.pathname === "/api/google/calendar-list") {
        return new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
    }

    const eventMatch = /^\/api\/google\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!eventMatch) {
        return null;
    }

    let calendarId: string;
    try {
        calendarId = decodeURIComponent(eventMatch[1]);
    } catch {
        return null;
    }
    if (!calendarId || calendarId.length > 1024) {
        return null;
    }

    const upstream = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
    for (const [name, value] of url.searchParams) {
        if (!EVENT_PARAMETERS.has(name)) {
            return null;
        }
        upstream.searchParams.append(name, value);
    }
    return upstream;
}

export async function googleCalendar(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
        return methodNotAllowed("GET");
    }

    const auth = await requireEntitlement(request, env);
    if (auth instanceof Response) {
        return auth;
    }

    const googleToken = request.headers.get("X-Google-Access-Token");
    if (!googleToken) {
        return json({ error: "Google Calendar authorization required" }, { status: 401 });
    }

    const upstream = upstreamUrl(new URL(request.url));
    if (!upstream) {
        return json({ error: "Unsupported Google Calendar request" }, { status: 400 });
    }

    const response = await fetch(upstream, {
        headers: {
            Authorization: `Bearer ${googleToken}`,
            Accept: "application/json"
        }
    });
    const body = await response.text();
    return new Response(body, {
        status: response.status,
        headers: {
            "Content-Type": response.headers.get("Content-Type") ?? "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}