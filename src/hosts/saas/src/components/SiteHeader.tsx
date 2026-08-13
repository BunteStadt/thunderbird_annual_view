import { useState } from "react";
import { CircleUserRound, LogIn, Menu, X } from "lucide-react";
import { SiThunderbird } from "react-icons/si";
import yearViewLogo from "../../../../../assets/icons/Yearview_logo.svg";
import { Link, type Navigate } from "./Link";

type Session = { user: { email: string | null } } | null;

export function SiteHeader({ navigate, path, session }: { navigate: Navigate; path: string; session: Session }) {
    const [open, setOpen] = useState(false);
    const isDemoPage = path === "/demo";
    const closeAndNavigate = (nextPath: string) => {
        setOpen(false);
        navigate(nextPath);
    };

    return (
        <header className="site-header">
            <nav className="page-width nav-shell" aria-label="Primary navigation">
                <Link to="/" navigate={navigate} className="brand" aria-label="Year View home">
                    <img className="brand-logo" src={yearViewLogo} alt="" />
                    <span>Year View</span>
                </Link>
                <button type="button" className="icon-button menu-button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                    {open ? <X /> : <Menu />}
                </button>
                <button className="button button-primary nav-demo-link" type="button" onClick={() => closeAndNavigate(session ? "/app" : isDemoPage ? "/login?next=/account" : "/demo")}>
                    {session ? "Open Year View" : isDemoPage ? "Sign up" : "Open demo"}
                </button>
                <div className={`nav-links ${open ? "is-open" : ""}`}>
                    <a className="button button-quiet nav-addon-link" href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/" target="_blank" rel="noreferrer">
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