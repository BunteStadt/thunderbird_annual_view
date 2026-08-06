import Stripe from "stripe";

export function createStripe(env: Env): Stripe {
    return new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(),
        telemetry: false
    });
}