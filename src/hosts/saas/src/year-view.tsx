import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CircleUserRound } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { YearView as CoreYearView } from "../../../core/ui/annual-view";
import { EmptyCalendarProvider, registerProviderFactory, setCalendarProvider } from "../../../core/providers/calendar-service.js";
import { setStorageAdapter } from "../../../core/storage-port.js";
import { createWebHostStorageAdapter } from "../../web/web-storage-adapter.js";
import { createSaasGoogleProvider } from "./saas-google-provider";
import holidaysCalendar from "../../../../assets/demo_calendar/holidays-calendar.ics?raw";
import personalCalendar from "../../../../assets/demo_calendar/personal-calendar.ics?raw";
import projectCalendar from "../../../../assets/demo_calendar/project-calendar.ics?raw";
import workCalendar from "../../../../assets/demo_calendar/work-calendar.ics?raw";

const demoCalendars = [
    { id: "demo-holidays", name: "Holidays", color: "#d66b5d", content: holidaysCalendar },
    { id: "demo-personal", name: "Personal", color: "#4c8d80", content: personalCalendar },
    { id: "demo-project", name: "Project", color: "#c3914a", content: projectCalendar },
    { id: "demo-work", name: "Work", color: "#5b77a8", content: workCalendar }
];

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

export function YearView({ session, navigate, demo = false }: { session?: Session; navigate: (path: string) => void; demo?: boolean }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const provider = demo ? new EmptyCalendarProvider() : createSaasGoogleProvider(session!);
        setStorageAdapter(createWebHostStorageAdapter());
        registerProviderFactory("saas-google", () => provider);
        setCalendarProvider(provider);
        setReady(true);
    }, [session]);

    return (
        <main className={`year-view-page${demo ? "" : " app-page"}`}>
            {ready && <CoreYearView config={{
                icsCalendars: demo ? demoCalendars : undefined,
                icsReadOnly: demo,
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