import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { loadOnboardingCompleted, persistOnboardingCompleted } from "../storage.js";
import { Button } from "@/components/ui/button";
import { TOUR_EVENT } from "./onboarding-tour-events.js";

type TourStep = {
    target: string;
    title: string;
    text: string;
};

type OnboardingTourProps = {
    rootRef: RefObject<HTMLDivElement | null>;
    hasCalendars: boolean;
};

const calendarRequiredStep: TourStep = {
    target: "upload-ics",
    title: "Import a calendar to begin",
    text: "Upload an .ics file to add a calendar before continuing with the year view tour."
};

const steps: TourStep[] = [
    { target: "calendar-list", title: "Choose calendars", text: "Click a calendar name to include or remove it from the year view." },
    { target: "global-all-day", title: "Global All-day filter", text: "Show only events marked as all-day. All-day is an event flag, not simply an event lasting from 00:00 to 24:00." },
    { target: "global-duration", title: "Global duration filter", text: "Set the minimum event duration used by calendars that follow the global setting." },
    { target: "specific-all-day", title: "Per-calendar All-day filter", text: "Expand a calendar to set its own All-day setting. Reset the row to follow the global setting." },
    { target: "specific-duration", title: "Per-calendar duration filter", text: "Expand a calendar to set its own minimum duration. Reset the row to follow the global setting." },
    { target: "duration-filter", title: "Turn filtering on or off", text: "The global Duration filter switch overrides both global and per-calendar All-day and duration settings." },
    { target: "display-options", title: "Adjust the display", text: "Show week numbers, gray out past days, or highlight today to make the year easier to scan." },
    { target: "view-mode", title: "Select a view", text: "Choose compact, aligned, or a week-row layout to change how the year is arranged." },
    { target: "upload-ics", title: "Upload an ICS calendar", text: "Import one or more .ics files to add local calendars to the list." }
];

const targetSelectors: Record<string, string> = {
    "calendar-list": "#calendarList [data-tour=\"calendar-select\"]",
    "specific-all-day": ".calendar-row-details .cal-chip-toggle",
    "specific-duration": "[data-calendar-control=\"duration-input\"]"
};

function isCalendarDetailsStep(name: string) {
    return name === "specific-all-day" || name === "specific-duration";
}

function getTarget(root: HTMLElement, name: string) {
    return root.querySelector<HTMLElement>(targetSelectors[name] || `[data-tour="${name}"]`)
        || root.querySelector<HTMLElement>("#calendarFilters");
}

function getCalloutPosition(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(340, window.innerWidth - margin * 2);
    const below = rect.bottom + 210 < window.innerHeight;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    return {
        width: `${width}px`,
        left: `${left}px`,
        top: `${below ? rect.bottom + margin : Math.max(margin, rect.top - 210 - margin)}px`,
        placement: below ? "below" : "above"
    };
}

export function OnboardingTour({ rootRef, hasCalendars }: OnboardingTourProps) {
    const [running, setRunning] = useState(false);
    const [waitingForCalendar, setWaitingForCalendar] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [target, setTarget] = useState<HTMLElement | null>(null);
    const [position, setPosition] = useState({ width: "0px", left: "0px", top: "0px", placement: "below" });
    const [layoutTick, setLayoutTick] = useState(0);
    const nextButtonRef = useRef<HTMLButtonElement>(null);

    const start = () => {
        setCurrentStep(0);
        setWaitingForCalendar(!hasCalendars);
        setRunning(true);
    };

    const stop = () => {
        setRunning(false);
        setTarget(null);
    };

    const finish = () => {
        stop();
        void persistOnboardingCompleted(true);
    };

    useEffect(() => {
        const documentRoot = rootRef.current?.ownerDocument || document;
        const onRestart = () => start();
        documentRoot.addEventListener(TOUR_EVENT, onRestart);
        void loadOnboardingCompleted().then((completed) => {
            if (!completed) start();
        });
        return () => documentRoot.removeEventListener(TOUR_EVENT, onRestart);
    }, [rootRef]);

    useEffect(() => {
        if (running && waitingForCalendar && hasCalendars) {
            setWaitingForCalendar(false);
            setCurrentStep(0);
        }
    }, [hasCalendars, running, waitingForCalendar]);

    useLayoutEffect(() => {
        if (!running) return;
        const root = rootRef.current;
        if (!root) return;
        const step = waitingForCalendar ? calendarRequiredStep : steps[currentStep];
        const sidebar = root.querySelector<HTMLElement>("[data-slot=\"sidebar\"]");
        if (sidebar?.getAttribute("data-state") !== "expanded") {
            root.querySelector<HTMLElement>("[data-sidebar=\"trigger\"]")?.click();
            window.requestAnimationFrame(() => setLayoutTick((value) => value + 1));
            return;
        }
        if (isCalendarDetailsStep(step.target) && !root.querySelector(targetSelectors[step.target])) {
            root.querySelector<HTMLButtonElement>(".calendar-row button[aria-expanded='false']")?.click();
            window.requestAnimationFrame(() => setLayoutTick((value) => value + 1));
            return;
        }
        if (step.target === "display-options" || step.target === "view-mode") {
            const toggle = root.querySelector<HTMLElement>("#viewSettingsToggle");
            if (toggle?.getAttribute("aria-expanded") !== "true") {
                toggle?.click();
                window.requestAnimationFrame(() => setLayoutTick((value) => value + 1));
                return;
            }
        }
        const nextTarget = getTarget(root, step.target);
        setTarget(nextTarget);
        if (nextTarget) {
            setPosition(getCalloutPosition(nextTarget));
            nextTarget.classList.add("onboarding-tour-target");
        }
        return () => nextTarget?.classList.remove("onboarding-tour-target");
    }, [currentStep, layoutTick, rootRef, running, waitingForCalendar]);

    useLayoutEffect(() => {
        if (!target) return;
        const reposition = () => {
            setPosition(getCalloutPosition(target));
        };
        window.addEventListener("resize", reposition);
        window.addEventListener("scroll", reposition, true);
        return () => {
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
        };
    }, [target]);

    useEffect(() => {
        if (running) nextButtonRef.current?.focus();
    }, [currentStep, running, waitingForCalendar]);

    if (!running || !target) return null;

    const step = waitingForCalendar ? calendarRequiredStep : steps[currentStep];
    const stepLabel = waitingForCalendar ? "Before the tour" : `Step ${currentStep + 1} of ${steps.length}`;
    const nextLabel = waitingForCalendar ? "Import a calendar" : currentStep === steps.length - 1 ? "Done" : "Next";

    return (
        <section className="onboarding-tour" aria-label="Year View tour">
            <div
                className="onboarding-tour-card"
                role="dialog"
                aria-modal="false"
                aria-labelledby="onboarding-tour-title"
                data-placement={position.placement}
                style={{ width: position.width, left: position.left, top: position.top }}
            >
                <p className="onboarding-tour-step">{stepLabel}</p>
                <h2 id="onboarding-tour-title">{step.title}</h2>
                <p>{step.text}</p>
                <div className="onboarding-tour-actions">
                    <Button variant="ghost" onClick={finish}>Skip tour</Button>
                    <span className="onboarding-tour-spacer" />
                    <Button variant="outline" disabled={currentStep === 0} onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}>Back</Button>
                    <Button ref={nextButtonRef} disabled={waitingForCalendar} onClick={() => {
                        if (currentStep === steps.length - 1) finish();
                        else setCurrentStep((value) => value + 1);
                    }}>{nextLabel}</Button>
                </div>
            </div>
        </section>
    );
}
