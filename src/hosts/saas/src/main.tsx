import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
    ArrowRight,
    CalendarDays,
    Check,
    ChevronRight,
    CircleUserRound,
    CreditCard,
    Clock3,
    Eye,
    LogIn,
    LogOut,
    Menu,
    ShieldCheck,
    X
} from "lucide-react";
import { getSupabaseClient, safeReturnPath, signInWithGoogle } from "./auth";
import { redirectFromApi, type Subscription } from "./api";
import { YearView } from "./year-view";
import "./styles.css";

type Navigate = (path: string) => void;

function usePathname(): [string, Navigate] {
    const [pathname, setPathname] = useState(globalThis.location.pathname);

    useEffect(() => {
        const onPopState = () => setPathname(globalThis.location.pathname);
        globalThis.addEventListener("popstate", onPopState);
        return () => globalThis.removeEventListener("popstate", onPopState);
    }, []);

    const navigate = useCallback((path: string) => {
        globalThis.history.pushState(null, "", path);
        setPathname(globalThis.location.pathname);
        globalThis.scrollTo({ top: 0, behavior: "smooth" });
    }, []);

    return [pathname, navigate];
}

function Link({ to, navigate, children, className = "" }: {
    to: string;
    navigate: Navigate;
    children: ReactNode;
    className?: string;
}) {
    return (
        <a
            href={to}
            className={className}
            onClick={(event) => {
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
                    event.preventDefault();
                    navigate(to);
                }
            }}
        >
            {children}
        </a>
    );
}

function SiteHeader({ navigate, session }: { navigate: Navigate; session: Session | null }) {
    const [open, setOpen] = useState(false);
    const closeAndNavigate = (path: string) => {
        setOpen(false);
        navigate(path);
    };

    return (
        <header className="site-header">
            <nav className="page-width nav-shell" aria-label="Primary navigation">
                <Link to="/" navigate={navigate} className="brand" aria-label="Annual View home">
                    <span className="brand-mark"><CalendarDays aria-hidden="true" /></span>
                    <span>Annual View</span>
                </Link>
                <button
                    type="button"
                    className="icon-button menu-button"
                    aria-label={open ? "Close menu" : "Open menu"}
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                >
                    {open ? <X /> : <Menu />}
                </button>
                <div className={`nav-links ${open ? "is-open" : ""}`}>
                    <button type="button" onClick={() => closeAndNavigate("/pricing")}>Pricing</button>
                    <button type="button" onClick={() => closeAndNavigate("/privacy")}>Privacy</button>
                    <button type="button" className="button button-quiet" onClick={() => closeAndNavigate(session ? "/account" : "/login")}>
                        {session ? <CircleUserRound aria-hidden="true" /> : <LogIn aria-hidden="true" />} {session ? "Account" : "Sign in"}
                    </button>
                </div>
            </nav>
        </header>
    );
}

function SiteFooter({ navigate }: { navigate: Navigate }) {
    return (
        <footer className="site-footer">
            <div className="page-width footer-grid">
                <div>
                    <strong>Annual View</strong>
                    <p>A calmer way to understand the year ahead.</p>
                </div>
                <nav aria-label="Legal">
                    <Link to="/privacy" navigate={navigate}>Privacy</Link>
                    <Link to="/terms" navigate={navigate}>Terms</Link>
                    <Link to="/cancellation" navigate={navigate}>Cancellation</Link>
                    <Link to="/imprint" navigate={navigate}>Imprint</Link>
                </nav>
            </div>
        </footer>
    );
}

function ProductPreview() {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (
        <figure className="product-preview" aria-label="Preview of the annual calendar interface">
            <div className="preview-toolbar">
                <span>2026</span>
                <div><i /><i /><i /></div>
            </div>
            <div className="preview-grid">
                {months.map((month, index) => (
                    <div className="preview-month" key={month}>
                        <strong>{month}</strong>
                        <span className={`event-line event-${index % 4}`} />
                        <span className={`event-line event-${(index + 2) % 4}`} />
                        <span className="day-dots" />
                    </div>
                ))}
            </div>
            <figcaption>Preview of the Annual View calendar interface.</figcaption>
        </figure>
    );
}

function LandingPage({ navigate }: { navigate: Navigate }) {
    return (
        <>
            <main>
                <section className="hero page-width">
                    <div className="hero-copy reveal">
                        <p className="eyebrow"><Eye aria-hidden="true" /> One year. One clear view.</p>
                        <h1>Annual View</h1>
                        <p className="hero-lead">See the shape of your Google Calendar year before the busy weeks arrive.</p>
                        <div className="hero-actions">
                            <button className="button button-primary" type="button" onClick={() => navigate("/pricing")}>
                                Start for €1/month <ArrowRight aria-hidden="true" />
                            </button>
                            <a className="text-link" href="#how-it-works">How it works <ChevronRight aria-hidden="true" /></a>
                        </div>
                        <p className="fine-print">VAT included. Cancel anytime. Read-only Google Calendar access.</p>
                    </div>
                    <div className="preview-wrap reveal reveal-late">
                        <ProductPreview />
                    </div>
                </section>

                <section className="trust-band" aria-label="Product assurances">
                    <div className="page-width trust-list">
                        <span><ShieldCheck aria-hidden="true" /> Subscription checked securely</span>
                        <span><Eye aria-hidden="true" /> Calendar stays read-only</span>
                        <span><Clock3 aria-hidden="true" /> Understand twelve months at once</span>
                    </div>
                </section>

                <section id="how-it-works" className="page-width section-grid">
                    <div className="section-heading">
                        <p className="kicker">Designed for perspective</p>
                        <h2>Your calendar already has the details. Annual View reveals the pattern.</h2>
                    </div>
                    <ol className="steps">
                        <li><span>01</span><div><strong>Connect Google</strong><p>Use one familiar login and approve read-only Calendar access.</p></div></li>
                        <li><span>02</span><div><strong>Choose your calendars</strong><p>Filter work, family, travel, and long events without changing Google.</p></div></li>
                        <li><span>03</span><div><strong>Plan at year scale</strong><p>Move between compact and week-aligned views as your planning changes.</p></div></li>
                    </ol>
                </section>

                <section className="pricing-band">
                    <div className="page-width price-callout">
                        <div><p className="kicker">Simple on purpose</p><h2>Everything in the annual view.</h2></div>
                        <div className="price"><strong>€1</strong><span>per month<br />VAT included</span></div>
                        <button className="button button-inverse" type="button" onClick={() => navigate("/pricing")}>
                            See pricing <ArrowRight aria-hidden="true" />
                        </button>
                    </div>
                </section>
            </main>
            <SiteFooter navigate={navigate} />
        </>
    );
}

function PricingPage({ navigate, session }: { navigate: Navigate; session: Session | null }) {
    return (
        <main className="page-width inner-page">
            <header className="page-intro">
                <p className="kicker">One plan. No maze.</p>
                <h1>Keep the whole year in view.</h1>
                <p>One monthly plan with every current annual-view feature.</p>
            </header>
            <section className="pricing-layout">
                <div className="price-summary">
                    <span>Annual View membership</span>
                    <div><strong>€1</strong><p>per month<br />VAT included</p></div>
                    <button className="button button-primary button-wide" type="button" onClick={() => navigate(session ? "/account" : "/login?next=/account")}>
                        {session ? "Open account" : "Continue with Google"} <ArrowRight aria-hidden="true" />
                    </button>
                    <small>Cancel anytime. Access continues through the paid period.</small>
                </div>
                <div className="included">
                    <h2>Included</h2>
                    <ul>
                        <li><Check aria-hidden="true" /> Full annual Google Calendar view</li>
                        <li><Check aria-hidden="true" /> Multiple calendar selection</li>
                        <li><Check aria-hidden="true" /> Compact and week-aligned layouts</li>
                        <li><Check aria-hidden="true" /> Duration and all-day filters</li>
                        <li><Check aria-hidden="true" /> Light and dark display preferences</li>
                        <li><Check aria-hidden="true" /> Stripe-hosted billing management</li>
                    </ul>
                    <h3>What happens after checkout?</h3>
                    <p>Stripe confirms the subscription securely. Annual View opens as soon as the verified subscription reaches your account.</p>
                </div>
            </section>
        </main>
    );
}

function LoginPage({ navigate }: { navigate: Navigate }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const next = safeReturnPath(new URLSearchParams(globalThis.location.search).get("next"));

    const startLogin = async () => {
        setPending(true);
        setError("");
        try {
            await signInWithGoogle(next);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Google sign-in could not start.");
            setPending(false);
        }
    };

    return (
        <main className="auth-page page-width">
            <section className="auth-panel">
                <span className="auth-icon"><CircleUserRound aria-hidden="true" /></span>
                <p className="kicker">Welcome to Annual View</p>
                <h1>Sign in to see your year.</h1>
                <p>Google identifies your account and grants separate read-only access to your calendars.</p>
                <button className="button button-primary button-wide" type="button" disabled={pending} onClick={startLogin}>
                    <LogIn aria-hidden="true" /> {pending ? "Opening Google…" : "Continue with Google"}
                </button>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="back-link" type="button" onClick={() => navigate("/privacy")}>How your data is handled</button>
            </section>
        </main>
    );
}

function AuthCallback({ navigate }: { navigate: Navigate }) {
    const [message, setMessage] = useState("Completing secure sign-in…");

    useEffect(() => {
        const complete = async () => {
            const search = new URLSearchParams(globalThis.location.search);
            const code = search.get("code");
            const supabase = getSupabaseClient();
            if (!code || !supabase) {
                setMessage("The sign-in response is incomplete. Please return to login.");
                return;
            }
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
                setMessage("Sign-in could not be completed. Please try again.");
                return;
            }
            navigate(safeReturnPath(search.get("next")));
        };
        void complete();
    }, [navigate]);

    return <main className="status-page page-width"><CalendarDays aria-hidden="true" /><h1>{message}</h1></main>;
}

function useSubscription(session: Session | null) {
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [loading, setLoading] = useState(!!session);

    const refresh = async () => {
        if (!session) {
            setSubscription(null);
            setLoading(false);
            return null;
        }
        const supabase = getSupabaseClient();
        const { data, error } = await supabase!.from("subscriptions")
            .select("status,current_period_end,cancel_at_period_end,stripe_customer_id")
            .eq("user_id", session.user.id)
            .maybeSingle();
        if (error) throw error;
        const value = data as Subscription | null;
        setSubscription(value);
        setLoading(false);
        return value;
    };

    useEffect(() => {
        setLoading(!!session);
        void refresh().catch(() => setLoading(false));
    }, [session]);

    return { subscription, loading, refresh };
}

function AccountPage({ session, navigate }: { session: Session; navigate: Navigate }) {
    const { subscription, loading } = useSubscription(session);
    const [pending, setPending] = useState<"checkout" | "portal" | "logout" | "">("");
    const [error, setError] = useState("");
    const active = subscription?.status === "active";

    const run = async (action: "checkout" | "portal", path: string) => {
        setPending(action);
        setError("");
        try {
            await redirectFromApi(path);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The billing request failed.");
            setPending("");
        }
    };

    const signOut = async () => {
        setPending("logout");
        await getSupabaseClient()?.auth.signOut();
        navigate("/");
    };

    return (
        <main className="page-width account-page">
            <p className="kicker">Your account</p>
            <h1>Calendar access and billing.</h1>
            <div className="account-grid">
                <section className="account-section">
                    <CircleUserRound aria-hidden="true" />
                    <h2>Google account</h2>
                    <p>{session.user.email}</p>
                    <button className="button button-quiet" type="button" disabled={!!pending} onClick={signOut}>
                        <LogOut aria-hidden="true" /> {pending === "logout" ? "Signing out…" : "Sign out"}
                    </button>
                </section>
                <section className="account-section">
                    <CreditCard aria-hidden="true" />
                    <h2>Membership</h2>
                    <p>{loading ? "Checking subscription…" : active ? "Active · €1 per month" : "No active subscription"}</p>
                    {active ? (
                        <>
                            {subscription?.current_period_end && <small>Current period ends {new Date(subscription.current_period_end).toLocaleDateString()}.</small>}
                            <button className="button button-primary" type="button" disabled={!!pending} onClick={() => void run("portal", "/api/stripe/portal")}>Manage billing</button>
                            <button className="back-link" type="button" onClick={() => navigate("/app")}>Open Annual View</button>
                        </>
                    ) : (
                        <button className="button button-primary" type="button" disabled={loading || !!pending} onClick={() => void run("checkout", "/api/stripe/checkout")}>
                            {pending === "checkout" ? "Opening checkout…" : "Subscribe for €1/month"}
                        </button>
                    )}
                    {error && <p className="form-error" role="alert">{error}</p>}
                </section>
            </div>
        </main>
    );
}

function CheckoutSuccess({ session, navigate }: { session: Session; navigate: Navigate }) {
    const { subscription, refresh } = useSubscription(session);

    useEffect(() => {
        if (subscription?.status === "active") {
            navigate("/app");
            return;
        }
        const timer = globalThis.setInterval(() => void refresh(), 1500);
        const timeout = globalThis.setTimeout(() => globalThis.clearInterval(timer), 15000);
        return () => {
            globalThis.clearInterval(timer);
            globalThis.clearTimeout(timeout);
        };
    }, [subscription?.status]);

    return <main className="status-page page-width"><CalendarDays aria-hidden="true" /><h1>Confirming your membership…</h1><p>Stripe is securely updating your account.</p></main>;
}

function ProtectedApp({ session, navigate }: { session: Session; navigate: Navigate }) {
    const { subscription, loading } = useSubscription(session);
    if (loading) return <main className="status-page page-width"><CalendarDays aria-hidden="true" /><h1>Checking access…</h1></main>;
    if (subscription?.status !== "active") {
        return <main className="status-page page-width"><h1>An active membership is required.</h1><button className="button button-primary" onClick={() => navigate("/account")}>View membership</button></main>;
    }
    return <YearView session={session} />;
}

const legalContent: Record<string, { title: string; intro: string; sections: Array<[string, string]> }> = {
    "/privacy": {
        title: "Privacy",
        intro: "A plain-language outline for implementation review. Operator details require legal completion before launch.",
        sections: [
            ["What is processed", "Supabase processes account identity and subscription status. Stripe processes billing. Google provides read-only calendar data. Cloudflare serves the application and its protected endpoints."],
            ["Calendar data", "Calendar events are requested for the signed-in session and are not stored in the Supabase subscription database. Local preferences and imported ICS files stay in browser storage."],
            ["Launch requirement", "Replace this section with reviewed controller identity, retention periods, legal bases, user rights, processor details, and contact information before accepting live subscriptions."]
        ]
    },
    "/terms": {
        title: "Terms",
        intro: "Draft product terms pending operator and jurisdiction review.",
        sections: [["Service", "Annual View provides a read-only annual visualization of connected calendar data."], ["Launch requirement", "Add operator identity, acceptable use, availability, liability, governing law, and termination terms before launch."]]
    },
    "/cancellation": {
        title: "Cancellation",
        intro: "Subscriptions can be canceled at any time through Stripe Billing Portal.",
        sections: [["Access period", "Cancellation takes effect at the end of the current paid period. Access remains available until then."], ["Launch requirement", "Add the reviewed withdrawal and refund policy required by the operator's jurisdiction before launch."]]
    },
    "/imprint": {
        title: "Imprint",
        intro: "Required operator information must be completed before public launch.",
        sections: [["Operator", "TODO: legal name, address, authorized representative, and contact details."], ["Registration and tax", "TODO: applicable registration authority, registration number, and VAT identification details."]]
    }
};

function LegalPage({ path }: { path: string }) {
    const content = legalContent[path] ?? legalContent["/privacy"];
    return (
        <main className="page-width legal-page">
            <p className="kicker">Legal</p>
            <h1>{content.title}</h1>
            <p className="legal-intro">{content.intro}</p>
            {content.sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
        </main>
    );
}

function NotFound({ navigate }: { navigate: Navigate }) {
    return <main className="status-page page-width"><h1>That page is not here.</h1><button className="button button-primary" onClick={() => navigate("/")}>Return home</button></main>;
}

function App() {
    const [path, navigate] = usePathname();
    const [session, setSession] = useState<Session | null>(null);
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => {
        const supabase = getSupabaseClient();
        if (!supabase) {
            setAuthReady(true);
            return;
        }
        void supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setAuthReady(true);
        });
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
        return () => data.subscription.unsubscribe();
    }, []);

    let page: ReactNode;
    if (path === "/") page = <LandingPage navigate={navigate} />;
    else if (path === "/pricing") page = <PricingPage navigate={navigate} session={session} />;
    else if (path === "/login") page = <LoginPage navigate={navigate} />;
    else if (path === "/auth/callback") page = <AuthCallback navigate={navigate} />;
    else if (!authReady) page = <main className="status-page page-width"><CalendarDays aria-hidden="true" /><h1>Loading account…</h1></main>;
    else if (path === "/account" && session) page = <AccountPage session={session} navigate={navigate} />;
    else if (path === "/checkout/success" && session) page = <CheckoutSuccess session={session} navigate={navigate} />;
    else if (path === "/checkout/cancel" && session) page = <AccountPage session={session} navigate={navigate} />;
    else if (path === "/app" && session) page = <ProtectedApp session={session} navigate={navigate} />;
    else if (["/account", "/checkout/success", "/checkout/cancel", "/app"].includes(path)) page = <LoginPage navigate={navigate} />;
    else if (legalContent[path]) page = <LegalPage path={path} />;
    else page = <NotFound navigate={navigate} />;

    return <><SiteHeader navigate={navigate} session={session} />{page}</>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);