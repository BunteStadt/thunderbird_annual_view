import { loadOnboardingCompleted, persistOnboardingCompleted } from "../storage.js";

const TOUR_EVENT = "annual-view:restart-tour";

const steps = [
    { target: "calendar-list", title: "Choose calendars", text: "Click a calendar name to include or remove it from the annual view." },
    { target: "global-all-day", title: "Global All-day filter", text: "Show only events marked as all-day. All-day is an event flag, not simply an event lasting from 00:00 to 24:00." },
    { target: "global-duration", title: "Global duration filter", text: "Set the minimum event duration used by calendars that follow the global setting." },
    { target: "specific-all-day", title: "Per-calendar All-day filter", text: "Use the first calendar's All-day control as a pattern for each calendar. A checkmark shows only all-day events; an x also shows timed events; a dash follows the global setting." },
    { target: "specific-duration", title: "Per-calendar duration filter", text: "Set a calendar-specific minimum duration. Use -1 to follow the global duration filter." },
    { target: "duration-filter", title: "Turn filtering on or off", text: "The global Duration filter switch overrides both global and per-calendar All-day and duration settings." },
    { target: "display-options", title: "Adjust the display", text: "Show week numbers, gray out past days, or highlight today to make the year easier to scan." },
    { target: "view-mode", title: "Select a view", text: "Choose compact, aligned, or a week-row layout to change how the year is arranged." },
    { target: "upload-ics", title: "Upload an ICS calendar", text: "Import one or more .ics files to add local calendars to the list." }
];

const targetSelectors = {
    "calendar-list": ".calendar-select-chip",
    "specific-all-day": ".calendar-mode-toggle",
    "specific-duration": ".calendar-duration-input"
};

function getTarget(root, name) {
    return root.querySelector(targetSelectors[name] || `[data-tour="${name}"]`) || root.querySelector("#calendarFilters");
}

function positionCallout(callout, target) {
    const rect = target.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(340, window.innerWidth - margin * 2);
    const below = rect.bottom + 210 < window.innerHeight;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    callout.style.width = `${width}px`;
    callout.style.left = `${left}px`;
    callout.style.top = `${below ? rect.bottom + margin : Math.max(margin, rect.top - 210 - margin)}px`;
    callout.dataset.placement = below ? "below" : "above";
}

export function setupOnboardingTour({ root } = {}) {
    if (!root) return { destroy() {} };

    const documentRoot = root.ownerDocument || document;
    const tour = documentRoot.createElement("section");
    tour.className = "onboarding-tour";
    tour.hidden = true;
    tour.setAttribute("aria-label", "Annual view tour");
    root.appendChild(tour);

    let currentStep = 0;
    let activeTarget = null;
    let running = false;

    function stop() {
        running = false;
        tour.hidden = true;
        activeTarget?.classList.remove("onboarding-tour-target");
        activeTarget = null;
    }

    function render() {
        const step = steps[currentStep];
        const target = getTarget(root, step.target);
        activeTarget?.classList.remove("onboarding-tour-target");
        activeTarget = target;
        activeTarget.classList.add("onboarding-tour-target");
        tour.innerHTML = `<div class="onboarding-tour-card" role="dialog" aria-modal="false" aria-labelledby="onboarding-tour-title"><p class="onboarding-tour-step">Step ${currentStep + 1} of ${steps.length}</p><h2 id="onboarding-tour-title">${step.title}</h2><p>${step.text}</p><div class="onboarding-tour-actions"><button type="button" class="btn" data-tour-action="skip">Skip tour</button><span class="onboarding-tour-spacer"></span><button type="button" class="btn" data-tour-action="back"${currentStep === 0 ? " disabled" : ""}>Back</button><button type="button" class="btn onboarding-tour-next" data-tour-action="next">${currentStep === steps.length - 1 ? "Done" : "Next"}</button></div></div>`;
        tour.hidden = false;
        positionCallout(tour.firstElementChild, activeTarget);
        tour.querySelector("[data-tour-action='next']")?.focus();
    }

    async function finish() {
        stop();
        await persistOnboardingCompleted(true);
    }

    function start() {
        const toggle = root.querySelector("#toggleCalendars");
        if (toggle?.getAttribute("aria-expanded") !== "true") toggle?.click();
        currentStep = 0;
        running = true;
        render();
    }

    function onAction(event) {
        const action = event.target.closest?.("[data-tour-action]")?.dataset.tourAction;
        if (!action) return;
        if (action === "skip") void finish();
        else if (action === "back") {
            currentStep = Math.max(0, currentStep - 1);
            render();
        } else if (currentStep === steps.length - 1) void finish();
        else {
            currentStep += 1;
            render();
        }
    }

    const onRestart = () => start();
    const reposition = () => {
        if (running && activeTarget && !tour.hidden) positionCallout(tour.firstElementChild, activeTarget);
    };
    tour.addEventListener("click", onAction);
    documentRoot.addEventListener(TOUR_EVENT, onRestart);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    void loadOnboardingCompleted().then((completed) => {
        if (!completed) start();
    });

    return {
        destroy() {
            stop();
            tour.removeEventListener("click", onAction);
            documentRoot.removeEventListener(TOUR_EVENT, onRestart);
            window.removeEventListener("resize", reposition);
            window.removeEventListener("scroll", reposition, true);
            tour.remove();
        }
    };
}

export function restartOnboardingTour(documentRoot = document) {
    documentRoot.dispatchEvent(new CustomEvent(TOUR_EVENT));
}