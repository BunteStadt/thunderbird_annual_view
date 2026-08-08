import type { Session } from "@supabase/supabase-js";
import { GoogleAuthSession, GoogleCalendarProvider } from "../../../core/providers/google-calendar-provider.js";
import { getSupabaseClient, signInWithGoogle } from "./auth";

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
            await signInWithGoogle("/app", "none");
            throw new Error("Google Calendar authorization renewal started.");
        }
        this.session = session;

        let response = await fetch(googleUrl, {
            headers: {
                Authorization: `Bearer ${session.provider_token}`
            }
        });
        if (response.status === 401 || response.status === 403) {
            const refreshed = await supabase?.auth.refreshSession();
            const refreshedSession = refreshed?.data.session;
            if (refreshedSession?.provider_token) {
                this.session = refreshedSession;
                response = await fetch(googleUrl, {
                    headers: {
                        Authorization: `Bearer ${refreshedSession.provider_token}`
                    }
                });
                if (response.ok) {
                    return response.json();
                }
            }
            await signInWithGoogle("/app", "none");
            throw new Error("Google Calendar authorization renewal started.");
        }
        if (!response.ok) {
            throw new Error(`Google Calendar request failed (${response.status})`);
        }
        return response.json();
    }
}

export function createSaasGoogleProvider(session: Session) {
    return new GoogleCalendarProvider(new SupabaseGoogleAuthSession(session));
}