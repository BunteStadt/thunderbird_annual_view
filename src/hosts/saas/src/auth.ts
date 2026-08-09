import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnvironment } from "./env";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
    if (client) {
        return client;
    }

    const environment = getPublicEnvironment();
    if (!environment) {
        return null;
    }

    client = createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
        auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
            persistSession: true,
            autoRefreshToken: true
        }
    });
    return client;
}

export function safeReturnPath(value: string | null, fallback = "/app"): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
        return fallback;
    }
    return value;
}

export async function signInWithGoogle(returnPath: string, prompt = "consent"): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase is not configured. Add the values from .env.example.");
    }

    const callbackUrl = new URL("/auth/callback", globalThis.location.origin);
    callbackUrl.searchParams.set("next", safeReturnPath(returnPath));

    const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: callbackUrl.toString(),
            scopes: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly",
            queryParams: {
                prompt
            }
        }
    });

    if (error) {
        throw error;
    }
}