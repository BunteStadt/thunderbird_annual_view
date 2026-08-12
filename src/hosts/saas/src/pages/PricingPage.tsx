import { PricingTable } from "@clerk/react";

export function PricingPage() {
    return (
        <main className="page-width inner-page pricing-page">
            <header className="page-intro">
                <p className="kicker">One plan. No maze.</p>
                <h1>Keep the whole year in view.</h1>
                <p>Choose a Year View plan through Clerk Billing. Every current annual-view feature is included.</p>
            </header>
            <section className="pricing-layout"><PricingTable newSubscriptionRedirectUrl="/app" /></section>
        </main>
    );
}