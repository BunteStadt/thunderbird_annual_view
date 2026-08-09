import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import {
    ArrowRight,
    CalendarDays,
    Check,
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
import { SiGithub, SiThunderbird } from "react-icons/si";
import { getSupabaseClient, safeReturnPath, signInWithGoogle } from "./auth";
import { redirectFromApi, type Subscription } from "./api";
import { YearView } from "./year-view";
import imprintContent from "./legal/imprint";
import privacyContent from "./legal/privacy";
import termsContent from "./legal/terms";
import yearViewIcon from "../../../../assets/icons/annual_view_inverted.svg";
import "./styles.css";

type Navigate = (path: string) => void;

const oneWeekScreenshot = "https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/one-week-rows-light.png";
const twoWeekScreenshot = "https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/two-week-rows-light.png";

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

function SiteHeader({ navigate, path, session }: { navigate: Navigate; path: string; session: Session | null }) {
    const [open, setOpen] = useState(false);
    const isDemoPage = path === "/demo";
    const closeAndNavigate = (path: string) => {
        setOpen(false);
        navigate(path);
    };

    return (
        <header className="site-header">
            <nav className="page-width nav-shell" aria-label="Primary navigation">
                <Link to="/" navigate={navigate} className="brand" aria-label="Year View home">
                    <span className="brand-mark"><img src={yearViewIcon} alt="" /></span>
                    <span>Year View</span>
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
                <button className="button button-primary nav-demo-link" type="button" onClick={() => closeAndNavigate(session ? "/app" : isDemoPage ? "/login?next=/account" : "/demo")}>
                    {session ? "Open YearView" : isDemoPage ? "Sign up" : "Open demo"}
                </button>
                <div className={`nav-links ${open ? "is-open" : ""}`}>
                    <a
                        className="button button-quiet nav-addon-link"
                        href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <SiThunderbird aria-hidden="true" /> Thunderbird add-on
                    </a>
                    <button type="button" onClick={() => closeAndNavigate("/pricing")}>Pricing</button>
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
                <div className="footer-brand">
                    <strong>Year View</strong>
                    <span>Made with ❤️ in Germany</span>
                </div>
                <nav aria-label="Footer navigation">
                    <Link to="/pricing" navigate={navigate}>Pricing</Link>
                    <Link to="/demo" navigate={navigate}>Demo</Link>
                    <Link to="/login?next=/account" navigate={navigate}>Sign in</Link>
                    <a href="https://github.com/BunteStadt/thunderbird_annual_view" target="_blank" rel="noreferrer"><SiGithub aria-hidden="true" /> GitHub</a>
                    <a href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/" target="_blank" rel="noreferrer"><SiThunderbird aria-hidden="true" /> Thunderbird</a>
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
            <div className="product-preview-bar" aria-hidden="true">
                <span className="product-preview-name"><CalendarDays /> Year View</span>
                <span className="product-preview-status"><i /> Google Calendar connected</span>
            </div>
            <img src="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png" alt="Annual calendar with color-coded events and calendar filters" />
            <figcaption>Preview of the Year View calendar interface.</figcaption>
        </figure>
    );
}

function LandingCalendarBackdrop() {
    const year = new Date().getFullYear();
    const months = Array.from({ length: 192 }, (_, monthOffset) => {
        const date = new Date(year, monthOffset, 1);
        const month = date.getMonth();
        const monthYear = date.getFullYear();
        const daysInMonth = new Date(monthYear, month + 1, 0).getDate();
        const firstEventStart = (monthOffset * 5) % Math.max(daysInMonth - 8, 1) + 1;
        const secondEventStart = (monthOffset * 11 + 7) % Math.max(daysInMonth - 6, 1) + 1;
        return {
            name: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
            year: monthYear,
            events: monthOffset % 2 === 0 ? [
                { start: firstEventStart, length: 14 + monthOffset % 8, color: monthOffset % 4 },
                { start: secondEventStart, length: 7 + monthOffset % 10, color: (monthOffset + 1) % 4 }
            ] : [],
            days: Array.from({ length: 31 }, (_, day) => {
                if (day >= daysInMonth) return null;
                const dayDate = new Date(monthYear, month, day + 1);
                return {
                    number: day + 1,
                    weekend: dayDate.getDay() === 0 || dayDate.getDay() === 6
                };
            })
        };
    });

    return (
        <div className="landing-calendar-backdrop" aria-hidden="true">
            <div className="landing-calendar-grid">
                {months.map((month) => (
                    <div className="landing-calendar-row" key={`${month.name}-${month.year}`}>
                        <div className="landing-calendar-month"><span>{month.name}</span><small>{month.year}</small></div>
                        {month.days.map((day, index) => (
                            <div className={`landing-calendar-cell${day?.weekend ? " weekend" : ""}${day ? "" : " is-empty"}`} key={`${month.name}-${month.year}-${index}`}>
                                {day?.number}
                            </div>
                        ))}
                        <div className="landing-calendar-events">
                            {month.events.map((event, index) => (
                                <span
                                    className={`landing-calendar-event event-${event.color}`}
                                    key={`${month.name}-${month.year}-event-${index}`}
                                    style={{ gridColumn: `${event.start + 1} / span ${event.length}`, gridRow: index + 1 }}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function LandingPage({ navigate, session }: { navigate: Navigate; session: Session | null }) {
    return (
        <div className="landing-page">
            <LandingCalendarBackdrop />
            <main className="landing-main">
                <section className="hero">
                    <div className="hero-layout page-width">
                        <div className="hero-copy reveal">
                            <p className="eyebrow"><CalendarDays aria-hidden="true" /> Your Google Calendar, at year scale</p>
                            <h1>See your year <span>at a glance.</span></h1>
                            <p className="hero-lead">Year View shows your events on a full-year grid, making it easy to spot busy or free periods.</p>
                            <div className="hero-actions">
                                <button className="button button-primary hero-demo-button" type="button" onClick={() => navigate(session ? "/app" : "/demo")}>
                                    <Eye aria-hidden="true" /> {session ? "Open YearView" : "Try the demo"}
                                </button>
                            </div>
                            <div className="hero-assurance">
                                <ShieldCheck aria-hidden="true" />
                                <p><strong>How it works.</strong> Year View uses your Google Calendar event and calendar list data to show a full-year overview. Access is read-only: no event edits and no calendar data stored on our server.</p>
                            </div>
                        </div>
                        <div className="preview-wrap reveal reveal-late">
                            <ProductPreview />
                        </div>
                    </div>
                </section>

                <section className="problem-recognition" aria-labelledby="problem-title">
                    <div className="page-width problem-layout">
                        <div className="problem-intro">
                            <p className="kicker">Planning beyond one month</p>
                            <h2 id="problem-title">Some decisions need more than a month view.</h2>
                            <p>Important dates are spread across the year. Clicking forward loses the thread, while copying everything into another planner creates work that quickly goes stale.</p>
                        </div>
                        <div className="planning-questions" aria-label="Questions Year View helps you see in context">
                            <p>When you are trying to place one more thing, the questions sound familiar:</p>
                            <ul>
                                <li>When can the holiday fit between exams and existing events?</li>
                                <li>Is there room for the new project or event request?</li>
                                <li>Which upcoming weeks are already crowded?</li>
                                <li>Where are the quieter stretches?</li>
                                <li>Which deadlines must not disappear among everyday appointments?</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="solution-section" aria-labelledby="solution-title">
                    <div className="page-width solution-layout">
                        <div className="solution-intro">
                            <p className="kicker">One source of truth, a better perspective</p>
                            <h2 id="solution-title">Your calendar already has the details. Year View reveals the pattern.</h2>
                            <p>Year View arranges the events already in Google Calendar for long-range planning. Keep managing events where you always have; open Year View when you need a wider perspective.</p>
                        </div>
                        <div className="solution-benefits">
                            <article>
                                <span className="solution-number">01</span>
                                <h3>Start with what is already there</h3>
                                <p>Connect Google Calendar and use your existing events immediately. Nothing to copy or recreate.</p>
                            </article>
                            <article>
                                <span className="solution-number">02</span>
                                <h3>See busy and quiet periods</h3>
                                <p>Compare weeks and months without repeatedly navigating between separate calendar screens.</p>
                            </article>
                            <article>
                                <span className="solution-number">03</span>
                                <h3>Bring important dates forward</h3>
                                <p>Filter calendars, short appointments, and all-day events to reveal the commitments shaping the plan.</p>
                            </article>
                        </div>
                    </div>
                </section>

                <section className="demo-section" id="demo" aria-labelledby="demo-title">
                    <div className="page-width">
                        <div className="demo-heading">
                            <p className="kicker">Interactive demo</p>
                            <h2 id="demo-title">Try the real Year View.</h2>
                            <p>Explore a sample year, switch layouts, filter calendars, and scroll across year boundaries. No sign-in required.</p>
                            <a className="button button-primary demo-open-link" href="/demo">
                                Open demo full-screen <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                        <div className="demo-stage">
                            <div className="demo-stage-bar" aria-hidden="true">
                                <span></span><span></span><span></span>
                                <small>annualview / sample year</small>
                            </div>
                            <div className="demo-frame">
                                <iframe src="/demo?embed=1" title="Interactive Year View sample year" loading="lazy" referrerPolicy="no-referrer" />
                            </div>
                        </div>
                    </div>
                </section>

                <section className="outcomes-section" aria-labelledby="outcomes-title">
                    <div className="page-width outcomes-layout">
                        <div className="outcomes-intro">
                            <p className="kicker">Outcomes and use cases</p>
                            <h2 id="outcomes-title">See where the year gets busy, and where plans can breathe.</h2>
                        </div>
                        <div className="outcomes-grid">
                            <article>
                                <span className="outcome-number">01</span>
                                <h3>Plan travel with context</h3>
                                <p>Compare holidays, exams, work commitments, and existing trips before choosing dates.</p>
                            </article>
                            <article>
                                <span className="outcome-number">02</span>
                                <h3>Place projects and events</h3>
                                <p>See which periods are already crowded before accepting a request or choosing a start date.</p>
                            </article>
                            <article>
                                <span className="outcome-number">03</span>
                                <h3>Keep deadlines visible</h3>
                                <p>Surface milestones and important all-day events without losing them among short appointments.</p>
                            </article>
                            <article>
                                <span className="outcome-number">04</span>
                                <h3>Understand the rhythm ahead</h3>
                                <p>Recognize demanding months, recurring patterns, and quieter stretches at a glance.</p>
                            </article>
                        </div>
                    </div>
                </section>

                <section className="features-section" aria-labelledby="features-title">
                    <div className="page-width">
                        <div className="features-heading">
                            <p className="kicker">Features that support the outcome</p>
                            <h2 id="features-title">Change the view. Filter the noise.</h2>
                        </div>
                        <div className="feature-view-gallery">
                            <ModeCard className="mode-card-left" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/linear-light.png" alt="Compact annual calendar view showing a full year">
                                <figcaption><strong>Compact</strong><span>See the broad annual pattern across the whole year at once.</span></figcaption>
                            </ModeCard>
                            <ModeCard className="mode-card-right" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/day-aligned-light.png" alt="Day-aligned annual calendar view with weekdays lined up">
                                <figcaption><strong>Aligned</strong><span>Keep weekdays lined up when weekly rhythm matters.</span></figcaption>
                            </ModeCard>
                            <ModeCard className="mode-card-left" image="https://github.com/BunteStadt/thunderbird_annual_view/releases/latest/download/week-rows-light.png" alt="Four-week annual calendar view with full weeks">
                                <figcaption><strong>4-week</strong><span>Read each month as full weeks for projects and vacations.</span></figcaption>
                            </ModeCard>
                            <ModeCard className="mode-card-right" image={twoWeekScreenshot} alt="Two-week annual calendar view with more detail">
                                <figcaption><strong>2-week</strong><span>Give each fortnight more room while keeping the year in view.</span></figcaption>
                            </ModeCard>
                            <ModeCard className="mode-card-left" image={oneWeekScreenshot} alt="One-week annual calendar view for detailed planning">
                                <figcaption><strong>1-week</strong><span>Use the most detail for busy periods and date-by-date planning.</span></figcaption>
                            </ModeCard>
                        </div>
                        <article className="feature-filter-panel">
                            <div className="feature-panel-copy">
                                <span className="feature-label">Focus on what shapes the plan</span>
                                <h3>Filter the noise without changing your calendar.</h3>
                                <ul>
                                    <li>Select the calendars relevant to the current decision</li>
                                    <li>Show only all-day events for holidays, deadlines, and milestones</li>
                                    <li>Hide short appointments with duration filters</li>
                                    <li>Use week numbers, past-day treatment, and today's highlight for orientation</li>
                                </ul>
                            </div>
                        </article>
                    </div>
                </section>

                <section className="social-proof-section" aria-labelledby="social-proof-title">
                    <div className="page-width social-proof-layout">
                        <div className="social-proof-intro">
                            <p className="kicker">Open-source proof</p>
                            <h2 id="social-proof-title">A year view people were missing.</h2>
                            <p>The open-source Thunderbird edition already helps 114 people use an annual calendar view and has received three 5-star ratings.</p>
                            <a className="text-link" href="https://addons.thunderbird.net/en-US/thunderbird/addon/calendar-annual-view/" target="_blank" rel="noreferrer">
                                <SiThunderbird aria-hidden="true" /> See the Thunderbird edition <ArrowRight aria-hidden="true" />
                            </a>
                        </div>
                        <div className="social-proof-quotes">
                            <blockquote>
                                <p>“Great! Very useful!”</p>
                                <cite><span>Firefox-Benutzer 02fb61</span><a href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177605/" target="_blank" rel="noreferrer"><SiThunderbird aria-hidden="true" /> Thunderbird Add-ons review</a></cite>
                            </blockquote>
                            <blockquote>
                                <p>“Very nice tool. I really missed an annual view in Thunderbird.”</p>
                                <cite><span>LaughingT</span><a href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177473/" target="_blank" rel="noreferrer"><SiThunderbird aria-hidden="true" /> Thunderbird Add-ons review</a></cite>
                            </blockquote>
                            <blockquote>
                                <p>“Thanks for making this!”</p>
                                <cite><span>NIronwolf</span><a href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/reviews/1177523/" target="_blank" rel="noreferrer"><SiThunderbird aria-hidden="true" /> Thunderbird Add-ons review</a></cite>
                            </blockquote>
                        </div>
                    </div>
                </section>

                <section className="privacy-proof-section" aria-labelledby="privacy-proof-title">
                    <div className="page-width privacy-proof-layout">
                        <div className="privacy-proof-intro">
                            <p className="kicker">Privacy and open source</p>
                            <h2 id="privacy-proof-title">Your calendar stays your calendar.</h2>
                            <p className="privacy-proof-lead">Year View is built to look, not touch.</p>
                            <p>Events are processed only as needed to display them and are not persistently stored by Year View.</p>
                            <div className="privacy-proof-actions">
                                <a className="button button-primary" href="https://github.com/BunteStadt/thunderbird_annual_view" target="_blank" rel="noreferrer">
                                    <SiGithub aria-hidden="true" /> View source on GitHub <ArrowRight aria-hidden="true" />
                                </a>
                                <Link className="text-link" to="/privacy" navigate={navigate}>Read the privacy policy <ArrowRight aria-hidden="true" /></Link>
                            </div>
                        </div>
                        <div className="privacy-boundaries">
                            <div><ShieldCheck aria-hidden="true" /><span>Google access is read-only. Year View cannot create, edit, or delete events.</span></div>
                            <div><ShieldCheck aria-hidden="true" /><span>Calendar requests and responses are encrypted in transit.</span></div>
                            <div><ShieldCheck aria-hidden="true" /><span>Events are securely requested from Google only when needed and displayed in your browser.</span></div>
                            <div><ShieldCheck aria-hidden="true" /><span>Google Calendar remains the source of truth. Events are never saved to the Year View database or server cache.</span></div>
                            <div><ShieldCheck aria-hidden="true" /><span>Year View is open source, so its data handling can be inspected, followed, and improved in public.</span></div>
                        </div>
                    </div>
                </section>

                <section className="faq-section" aria-labelledby="faq-title">
                    <div className="page-width faq-layout">
                        <div className="faq-intro">
                            <p className="kicker">Frequently asked questions</p>
                            <h2 id="faq-title">The useful answers, before you connect.</h2>
                        </div>
                        <div className="faq-list">
                            <details>
                                <summary>Can Year View change my Google Calendar?</summary>
                                <p>No. Access is read-only. Year View cannot create, edit, or delete events.</p>
                            </details>
                            <details>
                                <summary>Are my calendar events stored by Year View?</summary>
                                <p>No. Events are securely requested from Google when needed and displayed in the browser. They are not saved to the Year View database or server cache.</p>
                            </details>
                            <details>
                                <summary>Do I need to enter my events again?</summary>
                                <p>No. Year View uses events already maintained in Google Calendar, so there is no duplicate calendar to keep synchronized.</p>
                            </details>
                            <details>
                                <summary>Does Year View recommend free dates?</summary>
                                <p>No. It gives you the long-range context to recognize busy periods and open stretches and make that decision yourself.</p>
                            </details>
                            <details>
                                <summary>Can I choose which events I see?</summary>
                                <p>Yes. Select calendars and use all-day and duration filters to focus on the events relevant to the current planning decision.</p>
                            </details>
                            <details>
                                <summary>Is there a free trial?</summary>
                                <p>There is no trial. The interactive demo lets visitors use the real interface with sample data before subscribing. The full service costs 2€ per month or 12€ annually, and can be cancelled anytime.</p>
                            </details>
                            <details>
                                <summary>What happens when I cancel?</summary>
                                <p>Access continues until the end of the paid period. Billing is managed securely through Stripe.</p>
                            </details>
                        </div>
                    </div>
                </section>

                <section className="pricing-band">
                    <div className="page-width access-callout">
                        <div className="final-conversion-copy">
                            <p className="kicker">Your events. A clearer year.</p>
                            <h2>Ready to see your own year?</h2>
                            <p>Connect your Google Calendar for 2€ per month or 12€ annually. Every current view and filter is included. Cancel anytime.</p>
                            <small>Read-only access. Access continues through the paid period after cancellation.</small>
                        </div>
                        <button className="button button-inverse" type="button" onClick={() => navigate("/login?next=/account")}>
                            Continue with Google <ArrowRight aria-hidden="true" />
                        </button>
                    </div>
                </section>
            </main>
        </div>
    );
}

function PricingPage({ navigate, session }: { navigate: Navigate; session: Session | null }) {
    const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("annual");
    const annualBilling = billingPeriod === "annual";
    const accountPath = `/account?billing=${billingPeriod}`;

    return (
        <main className="page-width inner-page pricing-page">
            <header className="page-intro">
                <p className="kicker">One plan. No maze.</p>
                <h1>Keep the whole year in view.</h1>
                <p>Choose the billing rhythm that fits you. Every current annual-view feature is included.</p>
            </header>
            <section className="pricing-layout">
                <div className="price-summary">
                    <span>Year View pricing</span>
                    <fieldset className="pricing-switch">
                        <legend>Billing period</legend>
                        <label>
                            <input type="radio" name="pricing-period" value="annual" checked={annualBilling} onChange={() => setBillingPeriod("annual")} />
                            <span>Annual <strong>1€/month</strong></span>
                        </label>
                        <label>
                            <input type="radio" name="pricing-period" value="monthly" checked={!annualBilling} onChange={() => setBillingPeriod("monthly")} />
                            <span>Monthly <strong>2€/month</strong></span>
                        </label>
                    </fieldset>
                    <div><strong>{annualBilling ? "1€" : "2€"}</strong><p>per month<br />{annualBilling ? "12€ billed annually" : "billed monthly"}</p></div>
                    <button className="button button-primary button-wide" type="button" onClick={() => navigate(session ? accountPath : `/login?next=${encodeURIComponent(accountPath)}`)}>
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
                    <p>Stripe confirms your subscription securely, and you are forwarded to YearView.</p>
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
                <p className="kicker">Welcome to Year View</p>
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
    const completed = useRef(false);

    useEffect(() => {
        if (completed.current) {
            return;
        }
        completed.current = true;

        const complete = async () => {
            const search = new URLSearchParams(globalThis.location.search);
            const code = search.get("code");
            const supabase = getSupabaseClient();
            const oauthError = search.get("error_description") ?? search.get("error");
            if (oauthError) {
                setMessage(`Sign-in was not completed: ${oauthError}`);
                return;
            }
            if (!code || !supabase) {
                setMessage("The sign-in response is incomplete. Please return to login.");
                return;
            }
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
                setMessage("Sign-in could not be completed. Please try again.");
                return;
            }
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
                setMessage("Sign-in completed, but the session was not available yet. Please try again.");
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
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">(() => new URLSearchParams(globalThis.location.search).get("billing") === "monthly" ? "monthly" : "annual");
    const active = subscription?.status === "active";
    const cancellationScheduled = active && subscription?.cancel_at_period_end === true;

    const run = async (action: "checkout" | "portal", path: string) => {
        setPending(action);
        setError("");
        try {
            await redirectFromApi(path, action === "checkout" ? {
                body: JSON.stringify({ termsAccepted: true, billingPeriod }),
                headers: { "Content-Type": "application/json" }
            } : undefined);
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
            <div className="account-grid">
                <section className="account-section account-profile">
                    <CircleUserRound aria-hidden="true" />
                    <h2>Google account</h2>
                    <p>{session.user.email}</p>
                    <button className="button button-quiet" type="button" disabled={!!pending} onClick={signOut}>
                        <LogOut aria-hidden="true" /> {pending === "logout" ? "Signing out…" : "Sign out"}
                    </button>
                </section>
                <section className="account-section membership-section">
                    <CreditCard aria-hidden="true" />
                    <h2>Membership</h2>
                    <p>{loading ? "Checking subscription…" : cancellationScheduled ? "Cancellation scheduled" : active ? "Active subscription" : "No active subscription"}</p>
                    {active ? (
                        <>
                            {subscription?.current_period_end && <small>{cancellationScheduled ? "Access remains available until " : "Current period ends "}{new Date(subscription.current_period_end).toLocaleDateString()}.</small>}
                            <button className="button button-primary" type="button" disabled={!!pending} onClick={() => void run("portal", "/api/stripe/portal")}>Manage billing</button>
                        </>
                    ) : (
                        <>
                            <fieldset className="billing-options">
                                <legend>Choose billing period</legend>
                                <label>
                                    <input type="radio" name="billing-period" value="monthly" checked={billingPeriod === "monthly"} onChange={() => setBillingPeriod("monthly")} />
                                    <span><strong>2€</strong> monthly</span>
                                </label>
                                <label>
                                    <input type="radio" name="billing-period" value="annual" checked={billingPeriod === "annual"} onChange={() => setBillingPeriod("annual")} />
                                    <span><strong>12€</strong> annually</span>
                                </label>
                            </fieldset>
                            <label className="terms-consent">
                                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                                <span>I agree to the <Link to="/terms" navigate={navigate}>Terms</Link>, acknowledge the <Link to="/privacy" navigate={navigate}>Privacy Policy</Link>, and have read the <Link to="/cancellation" navigate={navigate}>withdrawal information</Link>.</span>
                            </label>
                            <button className="button button-primary" type="button" disabled={loading || !!pending || !termsAccepted} onClick={() => void run("checkout", "/api/stripe/checkout")}>
                                {pending === "checkout" ? "Opening checkout…" : `Subscribe for ${billingPeriod === "monthly" ? "2€/month" : "12€/year"}`}
                            </button>
                        </>
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

type LegalContent = {
    title: string;
    intro: string;
    sections: string[][];
};

const legalContent: Record<string, LegalContent> = {
    "/privacy": privacyContent,
    "/terms": termsContent,
    "/cancellation": {
        title: "Cancellation",
        intro: "Subscriptions can be canceled at any time through Stripe Billing Portal. This page also provides the withdrawal information for consumers.",
        sections: [
            ["Cancellation", "Open the Stripe Billing Portal from your Year View account and choose cancel subscription. Cancellation takes effect at the end of the current paid period. Access remains available until then."],
            ["Withdrawal right", "If you are a consumer, you generally have the right to withdraw from the subscription contract within 14 days without giving a reason. The period begins when the contract is concluded. To exercise the right, send an unambiguous statement to Richard Pergens, Stephanstraße 6, 52064 Aachen, Germany, or email info@yearview.org before the period expires. You may use the model wording below, but it is not required."],
            ["Model withdrawal wording", "I/We hereby withdraw from the contract for the provision of the Year View subscription. Ordered on: ____. Name: ____. Address: ____. Date: ____. Signature only required for a paper notice."],
            ["Effects of withdrawal", "After a valid withdrawal, we refund payments received without undue delay using the original payment method. If you expressly requested that service provision begin during the withdrawal period, you may owe the proportionate amount for service provided until withdrawal. Statutory exceptions and consumer rights remain unaffected."]
        ]
    },
    "/imprint": imprintContent
};

function LegalPage({ path }: { path: string }) {
    const content = legalContent[path] ?? legalContent["/privacy"];
    return (
        <main className={`page-width legal-page${path === "/imprint" ? " imprint-page" : ""}`}>
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
    const isEmbeddedDemo = path === "/demo" && new URLSearchParams(globalThis.location.search).get("embed") === "1";

    useEffect(() => {
        const documentClasses = [document.documentElement, document.body];
        documentClasses.forEach((element) => element.classList.toggle("embedded-demo-document", isEmbeddedDemo));
        return () => documentClasses.forEach((element) => element.classList.remove("embedded-demo-document"));
    }, [isEmbeddedDemo]);

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
    if (path === "/") page = <LandingPage navigate={navigate} session={session} />;
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

    const isAppRoute = path === "/app";
    const isAuthenticatedApp = isAppRoute && !!session;

    return <div className={isAuthenticatedApp ? "app-shell" : undefined}>
        {!isAuthenticatedApp && !isEmbeddedDemo && (!isAppRoute || authReady) && <SiteHeader navigate={navigate} path={path} session={session} />}
        {page}
        {!isEmbeddedDemo && (!isAppRoute || authReady) && <SiteFooter navigate={navigate} />}
    </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);