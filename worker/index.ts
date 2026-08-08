import { json, errorMessage } from "./shared/http";
import { stripeCheckout } from "./routes/stripe-checkout";
import { stripePortal } from "./routes/stripe-portal";
import { stripeWebhook } from "./routes/stripe-webhook";

export default {
    async fetch(request, env): Promise<Response> {
        const url = new URL(request.url);

        try {
            if (url.pathname === "/api/health") {
                if (request.method !== "GET") {
                    return json({ error: "Method not allowed" }, {
                        status: 405,
                        headers: { Allow: "GET" }
                    });
                }
                return json({ status: "ok" });
            }

            if (url.pathname === "/api/stripe/checkout") {
                return await stripeCheckout(request, env);
            }
            if (url.pathname === "/api/stripe/portal") {
                return await stripePortal(request, env);
            }
            if (url.pathname === "/api/stripe/webhook") {
                return await stripeWebhook(request, env);
            }
            if (url.pathname.startsWith("/api/")) {
                return json({ error: "Not found" }, { status: 404 });
            }

            return env.ASSETS.fetch(request);
        } catch (error) {
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