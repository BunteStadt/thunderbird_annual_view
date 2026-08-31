import { json, errorMessage } from "./shared/http";
import { createClerkClient } from "@clerk/backend";
import { fetchGoogleCalendars, fetchGoogleEvents } from "./google-calendar";

class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

function requestOrigin(request: Request): string {
    return request.headers.get("origin") ?? new URL(request.url).origin;
}

async function authenticate(request: Request, env: Env) {
    const clerk = createClerkClient({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY
    });
    return clerk.authenticateRequest(request, {
        authorizedParties: [requestOrigin(request)]
    });
}

async function googleAccessToken(request: Request, env: Env): Promise<string> {
    const requestState = await authenticate(request, env);
    if (!requestState.isAuthenticated) {
        throw new HttpError(401, `Unauthorized: ${requestState.reason || "authentication required"}`);
    }

    const { userId } = requestState.toAuth();
    if (!userId) throw new Error("Authenticated request did not contain a Clerk user ID.");
    const clerk = createClerkClient({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY
    });
    const tokenResponse = await clerk.users.getUserOauthAccessToken(userId, "google");
    const accessToken = tokenResponse.data[0]?.token;
    if (!accessToken) throw new Error("No Google OAuth token found for this user.");
    return accessToken;
}

function queryCalendarIds(url: URL): string[] {
    return url.searchParams.getAll("calendarId").filter(Boolean);
}

async function googleRoute(request: Request, env: Env, url: URL): Promise<Response> {
    const accessToken = await googleAccessToken(request, env);
    if (url.pathname === "/api/google/calendars") {
        return json({ calendars: await fetchGoogleCalendars(accessToken) });
    }
    if (url.pathname === "/api/google/events") {
        const year = Number(url.searchParams.get("year"));
        if (!Number.isInteger(year) || year < 1 || year > 9999) {
            return json({ error: "A valid year is required." }, { status: 400 });
        }
        return json({ events: await fetchGoogleEvents(accessToken, year, queryCalendarIds(url)) });
    }
    return json({ error: "Not found" }, { status: 404 });
}

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);

        try {
            if (request.method === "GET" && ["/api/google/calendars", "/api/google/events"].includes(url.pathname)) {
                return await googleRoute(request, env, url);
            }
            if (url.pathname === "/api/health") {
                if (request.method !== "GET") {
                    return json({ error: "Method not allowed" }, {
                        status: 405,
                        headers: { Allow: "GET" }
                    });
                }
                return json({ status: "ok" });
            }


            return env.ASSETS.fetch(request);
        } catch (error) {
            if (error instanceof HttpError) {
                return json({ error: error.message }, { status: error.status });
            }
            console.error(JSON.stringify({
                message: "request failed",
                error: errorMessage(error),
                method: request.method,
                path: url.pathname
            }));
            return json({ error: "Internal server error" }, { status: 500 });
        }
    }
} satisfies ExportedHandler<Env>;