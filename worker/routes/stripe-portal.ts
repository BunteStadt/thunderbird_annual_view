import { authenticate, getSubscription } from "../shared/supabase";
import { applicationUrl, json, methodNotAllowed } from "../shared/http";
import { createStripe } from "../shared/stripe";

export async function stripePortal(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
        return methodNotAllowed("POST");
    }

    const auth = await authenticate(request, env);
    if (auth instanceof Response) {
        return auth;
    }

    const subscription = await getSubscription(auth.adminClient, auth.user.id);
    if (!subscription?.stripe_customer_id) {
        return json({ error: "No billing account found" }, { status: 404 });
    }

    const stripe = createStripe(env);
    const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: applicationUrl(env, "/account")
    });
    return json({ url: session.url });
}