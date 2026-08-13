import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { ArrowLeft, CircleUserRound } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { YearView as CoreYearView } from "../../../core/ui/annual-view";
import { EmptyCalendarProvider, registerProviderFactory, setCalendarProvider } from "../../../core/providers/calendar-service.js";
import { setStorageAdapter } from "../../../core/storage-port.js";
import { createSaasStorageAdapter } from "./saas-storage-adapter.js";
import { createSaasGoogleProvider } from "./saas-google-provider";
import { demoCalendars } from "../../../core/demo-calendars.js";

function createSaasHeaderAction(slot: "header-leading" | "header-actions", navigate: (path: string) => void) {
    return {
        slot,
        mount(container: HTMLElement) {
            container.toggleAttribute("hidden", false);
            const action = document.createElement(slot === "header-leading" ? "a" : "button");
            action.className = "btn av-header-action";
            action.dataset.size = "compact";
            action.setAttribute("aria-label", slot === "header-leading" ? "Back to Year View home" : "Open account");
            action.title = slot === "header-leading" ? "Back to Year View home" : "Open account";
            if (slot === "header-leading") {
                action.setAttribute("href", "/");
                action.innerHTML = `${renderToStaticMarkup(<ArrowLeft aria-hidden="true" />)}<span>YearView</span>`;
            } else {
                action.setAttribute("type", "button");
                action.innerHTML = `${renderToStaticMarkup(<CircleUserRound aria-hidden="true" />)}<span>Account</span>`;
            }
            const onClick = (event: Event) => {
                if (slot === "header-leading") {
                    event.preventDefault();
                }
                navigate(slot === "header-leading" ? "/" : "/account");
            };
            action.addEventListener("click", onClick);
            container.replaceChildren(action);
            return {
                destroy: () => {
                    action.removeEventListener("click", onClick);
                    container.replaceChildren();
                    container.toggleAttribute("hidden", true);
                }
            };
        }
    };
}

export function YearView({ navigate, demo = false }: { navigate: (path: string) => void; demo?: boolean }) {
    const [ready, setReady] = useState(false);
    const { getToken } = useAuth();
    const [googleProvider] = useState(() => createSaasGoogleProvider(getToken));

    useEffect(() => {
        const provider = demo ? new EmptyCalendarProvider() : googleProvider;
        setStorageAdapter(createSaasStorageAdapter());
        registerProviderFactory(demo ? "saas-demo" : "saas-google", () => provider);
        setCalendarProvider(provider);
        setReady(true);
    }, [demo, googleProvider]);

    return (
        <main className={`year-view-page${demo ? "" : " app-page"}`}>
            {ready && <CoreYearView config={{
                icsCalendars: demo ? demoCalendars : undefined,
                icsReadOnly: false,
                demoMode: demo,
                selectAllCalendars: demo,
                embeddedDemo: demo && new URLSearchParams(globalThis.location.search).get("embed") === "1",
                uiModules: demo ? [] : [
                    createSaasHeaderAction("header-leading", navigate),
                    createSaasHeaderAction("header-actions", navigate)
                ]
            }} />}
        </main>
    );
}