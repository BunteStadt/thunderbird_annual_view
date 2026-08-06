import Stripe from "stripe";
import { json, methodNotAllowed } from "../shared/http";
import { createStripe } from "../shared/stripe";
import { getSubscription } from "../shared/supabase";
import { createClient } from "@supabase/supabase-js";

const HANDLED_EVENTS = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed"
]);

function adminClient(env: Env) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    });
}

function id(value: string | { id: string } | null): string | null {
    if (!value) return null;
    return typeof value === "string" ? value : value.id;
}

function invoiceSubscription(invoice: Stripe.Invoice): string | null {
    return id(invoice.parent?.subscription_details?.subscription ?? null);
}

async function eventSubscription(event: Stripe.Event, stripe: Stripe): Promise<Stripe.Subscription | null> {
    if (event.type.startsWith("customer.subscription.")) {
        return event.data.object as Stripe.Subscription;
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = id(session.subscription);
        return subscriptionId ? stripe.subscriptions.retrieve(subscriptionId) : null;
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
        const subscriptionId = invoiceSubscription(event.data.object as Stripe.Invoice);
        return subscriptionId ? stripe.subscriptions.retrieve(subscriptionId) : null;
    }

    return null;
}

async function syncSubscription(event: Stripe.Event, subscription: Stripe.Subscription, env: Env): Promise<void> {
    const userId = subscription.metadata.supabase_user_id;
    const item = subscription.items.data[0];
    if (!userId || !item) {
        throw new Error("Stripe subscription is missing required ownership or price metadata.");
    }

    const supabase = adminClient(env);
    const existing = await getSubscription(supabase, userId);
    const eventCreatedAt = new Date(event.created * 1000);
    if (existing?.stripe_event_created_at && new Date(existing.stripe_event_created_at) > eventCreatedAt) {
        return;
    }

    const { error } = await supabase.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: id(subscription.customer),
        stripe_subscription_id: subscription.id,
        stripe_price_id: item.price.id,
        status: subscription.status,
        current_period_end: new Date(item.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        stripe_event_created_at: eventCreatedAt.toISOString(),
        updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (error) {
        throw new Error(`Subscription synchronization failed: ${error.message}`);
    }
}

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
        return methodNotAllowed("POST");
    }

    const signature = request.headers.get("Stripe-Signature");
    if (!signature) {
        return json({ error: "Missing Stripe signature" }, { status: 400 });
    }

    const payload = await request.text();
    const stripe = createStripe(env);
    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(
            payload,
            signature,
            env.STRIPE_WEBHOOK_SECRET,
            undefined,
            Stripe.createSubtleCryptoProvider()
        );
    } catch {
        return json({ error: "Invalid Stripe signature" }, { status: 400 });
    }

    if (!HANDLED_EVENTS.has(event.type)) {
        return json({ received: true });
    }

    const supabase = adminClient(env);
    const { error: claimError } = await supabase.from("stripe_webhook_events").insert({
        event_id: event.id,
        event_type: event.type,
        event_created_at: new Date(event.created * 1000).toISOString()
    });
    if (claimError?.code === "23505") {
        return json({ received: true, duplicate: true });
    }
    if (claimError) {
        throw new Error(`Webhook event claim failed: ${claimError.message}`);
    }

    try {
        const subscription = await eventSubscription(event, stripe);
        if (subscription) {
            await syncSubscription(event, subscription, env);
        }
    } catch (error) {
        await supabase.from("stripe_webhook_events").delete().eq("event_id", event.id);
        throw error;
    }

    return json({ received: true });
}