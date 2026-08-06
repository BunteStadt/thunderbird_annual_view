import { getSupabaseClient } from "./auth";

export type Subscription = {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_customer_id: string | null;
};

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const supabase = getSupabaseClient();
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    if (!data.session) {
        throw new Error("Sign in is required.");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
    return fetch(path, { ...init, headers });
}

export async function redirectFromApi(path: string): Promise<void> {
    const response = await authenticatedFetch(path, { method: "POST" });
    const result = await response.json() as { url?: string; error?: string };
    if (!response.ok || !result.url) {
        throw new Error(result.error ?? "The billing request failed.");
    }
    globalThis.location.assign(result.url);
}