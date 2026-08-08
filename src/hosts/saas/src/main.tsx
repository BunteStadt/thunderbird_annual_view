import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import oneWeekScreenshot from "./assets/generated/one-week-rows-light.png";
import twoWeekScreenshot from "./assets/generated/two-week-rows-light.png";
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

function ModeCard({
    alt,
    children,
    className,
    image
}: {
    alt: string;
    children: ReactNode;
    className: string;
    image: string;
}) {
    const cardRef = useRef<HTMLElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const card = cardRef.current;
        if (!card || !("IntersectionObserver" in globalThis)) {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, { threshold: 0.18 });

        observer.observe(card);
        return () => observer.disconnect();
    }, []);

    return (
        <figure ref={cardRef} className={`mode-card ${className}${isVisible ? " is-visible" : ""}`}>
            <img src={image} alt={alt} loading="lazy" />
            {children}
        </figure>
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
                    <button type="button" onClick={() => closeAndNavigate("/pricing")}>Membership</button>
                    <button type="button" onClick={() => closeAndNavigate("/privacy")}>Privacy</button>
                    <button type="button" className="button button-quiet" onClick={() => closeAndNavigate(session ? "/account" : "/login")}>
                        {session ? <CircleUserRound aria-hidden="true" /> : <LogIn aria-hidden="true" />} {session ? "Account" : "Sign in"}
                    </button>
                    <button type="button" className="button button-primary nav-demo-link" onClick={() => closeAndNavigate(session ? "/app" : "/demo")}>
                        <Eye aria-hidden="true" /> {session ? "Open YearView" : "Open demo"}
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
    return (
        <figure className="product-preview" aria-label="Preview of the annual calendar interface">
            <img src="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png" alt="Annual calendar with color-coded events and calendar filters" />
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
                            <button className="button button-primary" type="button" onClick={() => navigate("/login?next=/account")}>
                                Get started <ArrowRight aria-hidden="true" />
                            </button>
                            <a className="text-link" href="#how-it-works">How it works <ChevronRight aria-hidden="true" /></a>
                        </div>
                        <p className="fine-print">Read-only Google Calendar access. Your schedule stays yours.</p>
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

                <section className="view-showcase page-width" aria-labelledby="view-showcase-title">
                    <div className="section-heading">
                        <p className="kicker">Five ways to see the year</p>
                        <h2 id="view-showcase-title">Choose the view that matches the work.</h2>
                    </div>
                    <div className="mode-showcase">
                        <ModeCard className="mode-card-left" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png" alt="Compact annual calendar view">
                            <figcaption><strong>Compact</strong><span>Scan the whole year for patterns, gaps, and recurring events.</span></figcaption>
                        </ModeCard>
                        <ModeCard className="mode-card-right" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-light.png" alt="Aligned annual calendar view">
                            <figcaption><strong>Aligned</strong><span>Keep weekdays lined up when weekly rhythm matters.</span></figcaption>
                        </ModeCard>
                        <ModeCard className="mode-card-left" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/week-rows-light.png" alt="Four-week annual calendar view">
                            <figcaption><strong>4-week</strong><span>Read each month as full weeks for projects and vacations.</span></figcaption>
                        </ModeCard>
                        <ModeCard className="mode-card-right" image={twoWeekScreenshot} alt="Two-week annual calendar view">
                            <figcaption><strong>2-week</strong><span>Give each fortnight more room without losing the year.</span></figcaption>
                        </ModeCard>
                        <ModeCard className="mode-card-left" image={oneWeekScreenshot} alt="One-week annual calendar view">
                            <figcaption><strong>1-week</strong><span>Use the most detail for busy periods and date-by-date planning.</span></figcaption>
                        </ModeCard>
                    </div>
                </section>

                <section className="planning-tools page-width" aria-labelledby="planning-tools-title">
                    <div className="section-heading">
                        <p className="kicker">Make the view fit the question</p>
                        <h2 id="planning-tools-title">A mode for the moment. A filter for the noise.</h2>
                    </div>
                    <div className="tool-guides">
                        <article className="tool-guide">
                            <span className="tool-guide-label">View modes</span>
                            <p className="tool-guide-intro">Start wide, then add detail only when you need it.</p>
                            <dl>
                                <div><dt>Compact</dt><dd>Scan the entire year quickly. Best for spotting seasons, gaps, and recurring patterns.</dd></div>
                                <div><dt>Aligned</dt><dd>Keep weekdays lined up across months. Useful when dates and weekly rhythm matter.</dd></div>
                                <div><dt>4-week</dt><dd>See each month as a sequence of full weeks. A strong fit for projects and vacation planning.</dd></div>
                                <div><dt>2-week</dt><dd>Give each fortnight more room while keeping the year visible in one continuous view.</dd></div>
                                <div><dt>1-week</dt><dd>Use the most detailed layout for busy periods, handovers, and date-by-date planning.</dd></div>
                            </dl>
                        </article>
                        <article className="tool-guide tool-guide-accent">
                            <span className="tool-guide-label">Filter options</span>
                            <p className="tool-guide-intro">Turn a full calendar into the signal you need right now.</p>
                            <dl>
                                <div><dt>Calendars</dt><dd>Show only the calendars that matter, such as work, family, travel, or school.</dd></div>
                                <div><dt>All-day events</dt><dd>Focus on holidays, milestones, and full-day commitments without timed appointments.</dd></div>
                                <div><dt>Minimum duration</dt><dd>Hide short appointments and surface blocks that shape the day or week.</dd></div>
                                <div><dt>Display helpers</dt><dd>Toggle week numbers, gray past days, and highlight today for faster orientation.</dd></div>
                            </dl>
                        </article>
                    </div>
                </section>

                <section className="live-demo page-width" id="live-demo" aria-labelledby="live-demo-title">
                    <div className="live-demo-copy">
                        <p className="kicker">Try the real interface</p>
                        <h2 id="live-demo-title">See how the pieces work together.</h2>
                        <p>Switch modes, open the options panel, and scroll through a sample year before you connect your own Google Calendar.</p>
                        <a className="text-link" href="/demo">Open the demo full-screen <ArrowRight aria-hidden="true" /></a>
                    </div>
                    <div className="live-demo-frame">
                        <iframe src="/demo" title="Interactive Annual View demo" loading="lazy" referrerPolicy="no-referrer" />
                    </div>
                </section>

                <section className="pricing-band">
                    <div className="page-width access-callout">
                        <div><p className="kicker">Ready when you are</p><h2>Give your year some room.</h2></div>
                        <button className="button button-inverse" type="button" onClick={() => navigate("/login?next=/account")}>
                            Continue with Google <ArrowRight aria-hidden="true" />
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
    return <YearView session={session} navigate={navigate} />;
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
    else if (path === "/demo") page = <YearView navigate={navigate} demo />;
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

    return <>{!(path === "/app" && session) && <SiteHeader navigate={navigate} session={session} />}{page}</>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);