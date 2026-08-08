import { authenticate, getSubscription } from "../shared/supabase";
import { applicationUrl, json, methodNotAllowed } from "../shared/http";
import { createStripe } from "../shared/stripe";

export async function stripeCheckout(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
        return methodNotAllowed("POST");
    }

    const auth = await authenticate(request, env);
    if (auth instanceof Response) {
        return auth;
    }

    let body: { termsAccepted?: unknown; billingPeriod?: unknown } | null = null;
    try {
        body = await request.json() as { termsAccepted?: unknown };
    } catch {
        return json({ error: "Terms acceptance is required before checkout." }, { status: 400 });
    }
    if (body?.termsAccepted !== true) {
        return json({ error: "Terms acceptance is required before checkout." }, { status: 400 });
    }
    const billingPeriod = body.billingPeriod === "annual" ? "annual" : body.billingPeriod === "monthly" || body.billingPeriod === undefined ? "monthly" : null;
    if (!billingPeriod) {
        return json({ error: "Choose a monthly or annual billing period." }, { status: 400 });
    }
    const priceId = billingPeriod === "annual" ? env.STRIPE_PRICE_ANNUAL_ID : env.STRIPE_PRICE_MONTHLY_ID || env.STRIPE_PRICE_ID;
    if (!priceId) {
        return json({ error: "The selected billing plan is not configured." }, { status: 500 });
    }

    const stripe = createStripe(env);
    const existing = await getSubscription(auth.adminClient, auth.user.id);
    let customerId = existing?.stripe_customer_id ?? null;

    if (!customerId) {
        const customer = await stripe.customers.create({
            email: auth.user.email,
            metadata: { supabase_user_id: auth.user.id }
        }, {
            idempotencyKey: `annual-view-customer-${auth.user.id}`
        });
        customerId = customer.id;

        const { error } = await auth.adminClient.from("subscriptions").upsert({
            user_id: auth.user.id,
            stripe_customer_id: customerId,
            status: existing?.status ?? "none",
            updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
        if (error) {
            throw new Error(`Customer mapping failed: ${error.message}`);
        }
    }

    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: auth.user.id,
        line_items: [{ price: priceId, quantity: 1 }],
        automatic_tax: { enabled: true },
        customer_update: { address: "auto" },
        subscription_data: {
            metadata: { supabase_user_id: auth.user.id }
        },
        success_url: applicationUrl(env, "/checkout/success"),
        cancel_url: applicationUrl(env, "/checkout/cancel")
    });

    if (!session.url) {
        throw new Error("Stripe did not return a Checkout URL.");
    }
    return json({ url: session.url });
}