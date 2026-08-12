import { SubscriptionDetailsButton } from "@clerk/react/experimental";
import { CalendarDays } from "lucide-react";
import { UserButton, useClerk, useUser } from "@clerk/react";
import type { Navigate } from "../components/Link";

export function AccountPage({ navigate }: { navigate: Navigate }) {
    const { signOut } = useClerk();
    const { user } = useUser();
    return (
        <main className="page-width account-page">
            <div className="account-grid">
                <section className="account-section account-profile">
                    <UserButton />
                    <h2>Account</h2>
                    <p>{user?.primaryEmailAddress?.emailAddress ?? "Signed in with Clerk"}</p>
                    <button className="button button-quiet" type="button" onClick={() => void signOut().then(() => navigate("/"))}>Sign out</button>
                </section>
                <section className="account-section membership-section">
                    <CalendarDays aria-hidden="true" />
                    <h2>Membership</h2>
                    <p>Manage your Year View plan and subscription through Clerk Billing.</p>
                    <SubscriptionDetailsButton><button className="button button-primary" type="button">Manage subscription</button></SubscriptionDetailsButton>
                </section>
            </div>
        </main>
    );
}