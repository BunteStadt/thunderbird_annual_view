import type { Session } from "@supabase/supabase-js";
import { GoogleAuthSession, GoogleCalendarProvider } from "../../../core/providers/google-calendar-provider.js";
import { getSupabaseClient, signInWithGoogle } from "./auth";

function proxyPath(googleUrl: string): string {
    const url = new URL(googleUrl);
    if (url.origin !== "https://www.googleapis.com") {
        throw new Error("Unsupported Google Calendar origin.");
    }
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return "/api/google/calendar-list";
    }

    const match = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    if (!match) {
        throw new Error("Unsupported Google Calendar operation.");
    }
    return `/api/google/calendars/${match[1]}/events${url.search}`;
}

class SupabaseGoogleAuthSession extends GoogleAuthSession {
    constructor(private session: Session) {
        super();
    }

    setClientId() {}
    getAuthState() {
        return { configured: true, authenticated: this.isAuthenticated(), clientId: "supabase" };
    }
    isAuthenticated() {
        return !!this.session.provider_token;
    }
    async signIn() {
        await signInWithGoogle("/app");
    }
    async signOut() {
        await getSupabaseClient()?.auth.signOut();
    }
    async authorizedFetch(googleUrl: string) {
        const supabase = getSupabaseClient();
        const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
        const session = data.session;
        if (!session?.provider_token) {
            throw new Error("Google Calendar authorization expired. Sign in again to reconnect it.");
        }
        this.session = session;

        const response = await fetch(proxyPath(googleUrl), {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                "X-Google-Access-Token": session.provider_token
            }
        });
        if (!response.ok) {
            throw new Error(`Google Calendar request failed (${response.status})`);
        }
        return response.json();
    }
}

export function createSaasGoogleProvider(session: Session) {
    return new GoogleCalendarProvider(new SupabaseGoogleAuthSession(session));
}