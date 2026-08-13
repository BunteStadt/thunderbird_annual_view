import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth, useUser } from "@clerk/react";
import { CalendarDays } from "lucide-react";
import { YearView } from "./year-view";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import type { Navigate } from "./components/Link";
import { AccountPage } from "./pages/AccountPage";
import { LandingPage } from "./pages/LandingPage";
import { ImprintPage } from "./pages/ImprintPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFound } from "./pages/NotFound";
import { PricingPage } from "./pages/PricingPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import "./styles.css";

type Session = { user: { email: string | null } };

function usePathname(): [string, Navigate] {
    const initialPath = new URLSearchParams(globalThis.location.search).get("demo") === "1"
        ? "/demo"
        : globalThis.location.pathname;
    const [pathname, setPathname] = useState(initialPath);

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

function App() {
    const [path, navigate] = usePathname();
    const { isLoaded, isSignedIn } = useAuth();
    const { user } = useUser();
    const session: Session | null = isSignedIn ? { user: { email: user?.primaryEmailAddress?.emailAddress ?? null } } : null;
    const isEmbeddedDemo = path === "/demo" && new URLSearchParams(globalThis.location.search).get("embed") === "1";

    useEffect(() => {
        const documentClasses = [document.documentElement, document.body];
        documentClasses.forEach((element) => element.classList.toggle("embedded-demo-document", isEmbeddedDemo));
        return () => documentClasses.forEach((element) => element.classList.remove("embedded-demo-document"));
    }, [isEmbeddedDemo]);

    let page: ReactNode;
    if (path === "/") page = <LandingPage navigate={navigate} session={session} />;
    else if (path === "/demo") page = <YearView navigate={navigate} demo />;
    else if (path === "/login") page = <LoginPage />;
    else if (path === "/pricing") page = <PricingPage />;
    else if (!isLoaded) page = <main className="status-page page-width"><CalendarDays aria-hidden="true" /><h1>Loading account...</h1></main>;
    else if (path === "/account" && session) page = <AccountPage navigate={navigate} />;
    else if (path === "/app" && session) page = <YearView navigate={navigate} />;
    else if (["/account", "/app"].includes(path)) page = <LoginPage />;
    else if (path === "/privacy") page = <PrivacyPage />;
    else if (path === "/terms") page = <TermsPage />;
    else if (path === "/imprint") page = <ImprintPage />;
    else page = <NotFound navigate={navigate} />;

    const isAppRoute = path === "/app";
    const isAuthenticatedApp = isAppRoute && !!session;
    return <div className={isAuthenticatedApp ? "app-shell" : undefined}>
        {!isAuthenticatedApp && !isEmbeddedDemo && (!isAppRoute || isLoaded) && <SiteHeader navigate={navigate} path={path} session={session} />}
        {page}
        {!isEmbeddedDemo && (!isAppRoute || isLoaded) && <SiteFooter navigate={navigate} />}
    </div>;
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ClerkProvider publishableKey={clerkPublishableKey}>
            <App />
        </ClerkProvider>
    </StrictMode>
);