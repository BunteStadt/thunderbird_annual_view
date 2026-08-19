import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton, useAuth } from "@clerk/react";
import { createPortal } from "react-dom";
import { YearView as CoreYearView } from "../../../core/ui/annual-view";
import { EmptyCalendarProvider, registerProviderFactory, setCalendarProvider } from "../../../core/providers/calendar-service.js";
import { setStorageAdapter } from "../../../core/storage-port.js";
import { createSaasStorageAdapter } from "./saas-storage-adapter.js";
import { createSaasGoogleProvider } from "./saas-google-provider";
import { demoCalendars } from "../../../core/demo-calendars.js";
import { Button } from "../../../core/ui/components/ui/button";

function createSaasHeaderAction(navigate: (path: string) => void) {
    return {
        slot: "header-leading",
        mount(container: HTMLElement) {
            container.toggleAttribute("hidden", false);
            const logo = container.querySelector<HTMLElement>(".av-header-logo");
            if (!logo) return { destroy: () => container.toggleAttribute("hidden", true) };
            const onClick = () => navigate("/");
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate("/");
                }
            };
            logo.setAttribute("role", "link");
            logo.setAttribute("tabindex", "0");
            logo.setAttribute("aria-label", "Year View home");
            logo.title = "Year View home";
            logo.addEventListener("click", onClick);
            logo.addEventListener("keydown", onKeyDown);
            return {
                destroy: () => {
                    logo.removeEventListener("click", onClick);
                    logo.removeEventListener("keydown", onKeyDown);
                    logo.removeAttribute("role");
                    logo.removeAttribute("tabindex");
                    logo.removeAttribute("aria-label");
                    logo.removeAttribute("title");
                }
            };
        }
    };
}

export function YearView({ navigate, demo = false }: { navigate: (path: string) => void; demo?: boolean }) {
    const [ready, setReady] = useState(false);
    const [headerActionsTarget, setHeaderActionsTarget] = useState<HTMLElement | null>(null);
    const pageRef = useRef<HTMLElement>(null);
    const { getToken } = useAuth();
    const [googleProvider] = useState(() => createSaasGoogleProvider(getToken));
    const config = useMemo(() => ({
        icsCalendars: demo ? demoCalendars : undefined,
        icsReadOnly: false,
        demoMode: demo,
        selectAllCalendars: demo,
        embeddedDemo: demo && new URLSearchParams(globalThis.location.search).get("embed") === "1",
        uiModules: demo ? [] : [
            createSaasHeaderAction(navigate)
        ]
    }), [demo, navigate]);

    useEffect(() => {
        const provider = demo ? new EmptyCalendarProvider() : googleProvider;
        setStorageAdapter(createSaasStorageAdapter());
        registerProviderFactory(demo ? "saas-demo" : "saas-google", () => provider);
        setCalendarProvider(provider);
        setReady(true);
    }, [demo, googleProvider]);

    useEffect(() => {
        if (!ready) return;
        const page = pageRef.current;
        if (!page) return;
        const findTarget = () => {
            const target = page.querySelector<HTMLElement>('[data-ui-slot="header-actions"]');
            if (target) {
                target.toggleAttribute("hidden", false);
                setHeaderActionsTarget(target);
            }
        };
        findTarget();
        const observer = new MutationObserver(findTarget);
        observer.observe(page, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [demo, ready]);

    return (
        <main ref={pageRef} className={`year-view-page${demo ? "" : " app-page"}`}>
            {ready && <CoreYearView config={config} />}
            {headerActionsTarget && createPortal(
                demo
                    ? <Button type="button" onClick={() => navigate("/login?next=/app")}>Sign up</Button>
                    : <UserButton />,
                headerActionsTarget
            )}
        </main>
    );
}