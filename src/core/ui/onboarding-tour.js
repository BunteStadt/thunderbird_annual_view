import { loadOnboardingCompleted, persistOnboardingCompleted } from "../storage.js";

const TOUR_EVENT = "year-view:restart-tour";
const calendarRequiredStep = {
    target: "upload-ics",
    title: "Import a calendar to begin",
    text: "Upload an .ics file to add a calendar before continuing with the year view tour."
};

const steps = [
    { target: "calendar-list", title: "Choose calendars", text: "Click a calendar name to include or remove it from the year view." },
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

export function setupOnboardingTour({ root, hasCalendars = () => true } = {}) {
    if (!root) return { destroy() { } };

    const documentRoot = root.ownerDocument || document;
    const tour = documentRoot.createElement("section");
    tour.className = "onboarding-tour";
    tour.hidden = true;
    tour.setAttribute("aria-label", "Year View tour");
    root.appendChild(tour);

    let currentStep = 0;
    let activeTarget = null;
    let running = false;
    let waitingForCalendar = false;

    function stop() {
        running = false;
        tour.hidden = true;
        activeTarget?.classList.remove("onboarding-tour-target");
        activeTarget = null;
    }

    function render() {
        const step = waitingForCalendar ? calendarRequiredStep : steps[currentStep];
        if (step.target === "display-options" || step.target === "view-mode") {
            const menu = root.querySelector("#viewSettingsMenu");
            const toggle = root.querySelector("#viewSettingsToggle");
            if (menu?.hidden) {
                menu.hidden = false;
                toggle?.setAttribute("aria-expanded", "true");
            }
        }
        const target = getTarget(root, step.target);
        activeTarget?.classList.remove("onboarding-tour-target");
        activeTarget = target;
        activeTarget.classList.add("onboarding-tour-target");
        const card = document.createElement("div");
        card.className = "onboarding-tour-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "false");
        card.setAttribute("aria-labelledby", "onboarding-tour-title");

        const stepLabel = document.createElement("p");
        stepLabel.className = "onboarding-tour-step";
        stepLabel.textContent = waitingForCalendar
            ? "Before the tour"
            : `Step ${currentStep + 1} of ${steps.length}`;
        card.appendChild(stepLabel);

        const title = document.createElement("h2");
        title.id = "onboarding-tour-title";
        title.textContent = step.title;
        card.appendChild(title);

        const description = document.createElement("p");
        description.textContent = step.text;
        card.appendChild(description);

        const actions = document.createElement("div");
        actions.className = "onboarding-tour-actions";
        const skipButton = document.createElement("button");
        skipButton.type = "button";
        skipButton.className = "btn";
        skipButton.dataset.tourAction = "skip";
        skipButton.textContent = "Skip tour";
        actions.appendChild(skipButton);
        const spacer = document.createElement("span");
        spacer.className = "onboarding-tour-spacer";
        actions.appendChild(spacer);
        const backButton = document.createElement("button");
        backButton.type = "button";
        backButton.className = "btn";
        backButton.dataset.tourAction = "back";
        backButton.disabled = currentStep === 0;
        backButton.textContent = "Back";
        actions.appendChild(backButton);
        const nextButton = document.createElement("button");
        nextButton.type = "button";
        nextButton.className = "btn onboarding-tour-next";
        nextButton.dataset.tourAction = "next";
        nextButton.disabled = waitingForCalendar;
        nextButton.textContent = waitingForCalendar ? "Import a calendar" : currentStep === steps.length - 1 ? "Done" : "Next";
        actions.appendChild(nextButton);
        card.appendChild(actions);
        tour.replaceChildren(card);
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
        waitingForCalendar = !hasCalendars();
        running = true;
        render();
    }

    function notifyCalendarStateChanged() {
        if (running && waitingForCalendar && hasCalendars()) {
            waitingForCalendar = false;
            currentStep = 0;
            render();
        }
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
        notifyCalendarStateChanged,
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