import { useState } from "react";
import { LogIn, Menu, X } from "lucide-react";
import { useAuth, UserButton } from "@clerk/react";
import { SiThunderbird } from "react-icons/si";
import yearViewLogo from "../../../../../assets/icons/Yearview_logo.svg";
import { Link, type Navigate } from "./Link";

export function SiteHeader({ navigate, path }: { navigate: Navigate; path: string }) {
    const [open, setOpen] = useState(false);
    const { isLoaded, isSignedIn } = useAuth();
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
                <button className="nav-pricing-link" type="button" onClick={() => closeAndNavigate("/pricing")}>Pricing</button>
                {isLoaded && isSignedIn ? (
                    <button className="button button-primary nav-demo-link" type="button" onClick={() => closeAndNavigate("/app")}>Open Year View</button>
                ) : isLoaded ? (
                    <button className="button button-primary nav-demo-link" type="button" onClick={() => closeAndNavigate(isDemoPage ? "/login?next=/app" : "/demo")}>
                        {isDemoPage ? "Sign up" : "Open demo"}
                    </button>
                ) : <span className="auth-control-placeholder nav-demo-placeholder" aria-hidden="true" />}
                <div className={`nav-links ${open ? "is-open" : ""}`}>
                    <a className="button button-quiet nav-addon-link" href="https://services.addons.thunderbird.net/De/thunderbird/addon/calendar-annual-view/" target="_blank" rel="noreferrer">
                        <SiThunderbird aria-hidden="true" /> Thunderbird add-on
                    </a>
                    {isLoaded && isSignedIn ? <UserButton fallback={<span className="auth-control-placeholder user-button-placeholder" aria-hidden="true" />} /> : isLoaded ? <button type="button" className="button button-quiet" onClick={() => closeAndNavigate("/login")}><LogIn aria-hidden="true" /> Sign in</button> : <span className="auth-control-placeholder user-button-placeholder" aria-hidden="true" />}
                </div>
            </nav>
        </header>
    );
}