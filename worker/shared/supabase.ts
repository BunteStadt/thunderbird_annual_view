import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { hasActiveSubscription } from "./entitlement";
import { json } from "./http";

export type SubscriptionRow = {
    user_id: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_event_created_at: string | null;
};

export type AuthenticatedRequest = {
    accessToken: string;
    user: User;
    userClient: SupabaseClient;
    adminClient: SupabaseClient;
};

function client(url: string, key: string, accessToken?: string): SupabaseClient {
    return createClient(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        },
        global: accessToken ? {
            headers: { Authorization: `Bearer ${accessToken}` }
        } : undefined
    });
}

export async function authenticate(request: Request, env: Env): Promise<AuthenticatedRequest | Response> {
    const authorization = request.headers.get("Authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
        return json({ error: "Authentication required" }, { status: 401 });
    }

    const accessToken = match[1];
    const userClient = client(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, accessToken);
    const { data, error } = await userClient.auth.getUser(accessToken);
    if (error || !data.user) {
        return json({ error: "Session expired" }, { status: 401 });
    }

    return {
        accessToken,
        user: data.user,
        userClient,
        adminClient: client(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    };
}

export async function getSubscription(
    supabase: SupabaseClient,
    userId: string
): Promise<SubscriptionRow | null> {
    const { data, error } = await supabase
        .from("subscriptions")
        .select("user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,status,current_period_end,cancel_at_period_end,stripe_event_created_at")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        throw new Error(`Subscription lookup failed: ${error.message}`);
    }
    return data as SubscriptionRow | null;
}

export async function requireEntitlement(
    request: Request,
    env: Env
): Promise<(AuthenticatedRequest & { subscription: SubscriptionRow }) | Response> {
    const auth = await authenticate(request, env);
    if (auth instanceof Response) {
        return auth;
    }

    const subscription = await getSubscription(auth.adminClient, auth.user.id);
    if (!subscription || !hasActiveSubscription(subscription.status)) {
        return json({ error: "Active subscription required" }, { status: 403 });
    }
    return { ...auth, subscription };
}