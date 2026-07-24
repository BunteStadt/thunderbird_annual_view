import { fetchCalendars } from "./calendar-service.js";
import { EventStore } from "./event-store.js";
import { GridView } from "./grid-view.js";
import {
    loadPersistedSelection,
    persistSelection,
    loadAllDayOnlyPreference,
    persistAllDayOnlyPreference,
    loadMinDurationPreference,
    persistMinDurationPreference,
    loadCalendarAllDayModes,
    persistCalendarAllDayModes,
    loadCalendarMinDurationHours,
    persistCalendarMinDurationHours,
    loadPanelState,
    persistPanelState,
    loadThemePreference,
    persistTheme,
    loadWeekNumbersPreference,
    persistWeekNumbersPreference,
    loadRefreshSettings,
    loadGrayPastDays,
    persistGrayPastDays,
    loadHighlightCurrentDay,
    persistHighlightCurrentDay,
    loadViewMode,
    persistViewMode
} from "./storage.js";
import { applyTheme, detectSystemMode } from "./theme.js";


// hardcoded dummy for dev
// globalThis.ENABLE_DUMMY_CALENDARS = true;




// Enable dummy data only when explicitly requested via ?dummy=1 (or when a
// test harness pre-set the flag before this module loaded).
if (typeof globalThis.ENABLE_DUMMY_CALENDARS !== "boolean") {
    const dummyParam = new URLSearchParams(globalThis.location?.search || "").get("dummy");
    globalThis.ENABLE_DUMMY_CALENDARS = dummyParam === "" || dummyParam === "1" || dummyParam === "true";
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const yearInput = document.getElementById("yearInput");
const gridViewport = document.getElementById("gridViewport");
const gridHeader = document.getElementById("gridHeader");
const gridRows = document.getElementById("gridRows");
const calendarList = document.getElementById("calendarList");
const calendarFilters = document.getElementById("calendarFilters");
const yearLayout = document.getElementById("yearLayout");
const allDayOnlyInput = document.getElementById("allDayOnly");
const showWeekNumbersInput = document.getElementById("showWeekNumbers");
const minDurationInput = document.getElementById("minDurationHours");
const minDurationDownBtn = document.getElementById("minDurationDown");
const minDurationUpBtn = document.getElementById("minDurationUp");
const durationFilterToggleBtn = document.getElementById("durationFilterToggle");
const selectAllBtn = document.getElementById("selectAllCals");
const deselectAllBtn = document.getElementById("deselectAllCals");
const toggleCalendarsBtn = document.getElementById("toggleCalendars");
const selectedSummary = document.getElementById("selectedSummary");
const themeToggleBtn = document.getElementById("themeToggle");
const refreshButton = document.getElementById("refreshButton");
const todayButton = document.getElementById("todayButton");
const grayPastDaysInput = document.getElementById("grayPastDays");
const highlightCurrentDayInput = document.getElementById("highlightCurrentDay");
const viewModeSelect = document.getElementById("viewMode");
const yearButtons = document.querySelectorAll("[data-year-step]");

const YEAR_MIN = Number(yearInput.min) || 1900;
const YEAR_MAX = Number(yearInput.max) || 2999;

const onClick = (el, handler) => el?.addEventListener("click", handler);
const onChange = (el, handler) => el?.addEventListener("change", handler);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let availableCalendars = [];
let selectedCalendarIds = new Set();
let calendarAllDayModes = {};
let calendarMinDurationHours = {};
let allDayOnlyEnabled = false;
let durationFilteringEnabled = true;
let currentYear = new Date().getFullYear();
let lastFilterStats = { filteredOut: 0, total: 0 };
let themeMode = "auto";
let systemThemeWatcher = null;
let autoRefreshTimer = null;
let refreshSettings = { autoRefreshEnabled: true, autoRefreshInterval: 300000 };
let isRefreshing = false;
let grayPastDaysEnabled = false;
let highlightCurrentDayEnabled = false;
let viewMode = "linear";

const eventStore = new EventStore();
const gridView = new GridView({
    viewport: gridViewport,
    header: gridHeader,
    rowsContainer: gridRows,
    eventStore,
    getOptions: () => ({
        showWeekNumbers: showWeekNumbersInput?.checked ?? true,
        grayPastDays: grayPastDaysEnabled,
        highlightCurrentDay: highlightCurrentDayEnabled,
        filters: getFilters()
    }),
    onYearChange: (year) => {
        currentYear = year;
        // Don't clobber the input while the user is typing a year.
        if (document.activeElement !== yearInput) {
            yearInput.value = year;
        }
        updateFilterStats();
    }
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const CALENDAR_ALL_DAY_MODE_SYMBOLS = { yes: "✓", no: "x", follow: "-" };

function getCalendarAllDayMode(calendarId) {
    const mode = calendarAllDayModes[calendarId];
    return mode === "yes" || mode === "no" || mode === "follow" ? mode : "follow";
}

function cycleCalendarAllDayMode(mode) {
    if (mode === "yes") return "no";
    if (mode === "no") return "follow";
    return "yes";
}

function getCalendarAllDayModeLabel(mode) {
    if (mode === "yes") return "all-day only yes";
    if (mode === "no") return "all-day only no";
    return "follow global all-day setting";
}

function getCalendarMinDurationHours(calendarId) {
    const hours = Number(calendarMinDurationHours[calendarId]);
    return Number.isFinite(hours) && hours >= 0 ? hours : -1;
}

// Returns the stored value (or -1 when the calendar follows the global filter).
function setCalendarMinDurationHours(calendarId, hours) {
    const duration = Number(hours);
    if (!Number.isFinite(duration) || duration < 0) {
        delete calendarMinDurationHours[calendarId];
        return -1;
    }
    const nextHours = Math.round(duration * 100) / 100;
    calendarMinDurationHours[calendarId] = nextHours;
    return nextHours;
}

function getGlobalMinDurationHours() {
    const val = Number(minDurationInput?.value);
    return Number.isFinite(val) && val >= 0 ? val : 0;
}

function getEffectiveMinDurationMs(calendarId) {
    if (!durationFilteringEnabled) {
        return 0;
    }
    const overrideHours = getCalendarMinDurationHours(calendarId);
    const effectiveHours = overrideHours >= 0 ? overrideHours : getGlobalMinDurationHours();
    return effectiveHours > 0 ? effectiveHours * 60 * 60 * 1000 : 0;
}

function updateDurationFilterToggleLabel() {
    if (!durationFilterToggleBtn) return;
    const stateLabel = durationFilteringEnabled ? "On" : "Off";
    durationFilterToggleBtn.textContent = `⏱ Duration filter: ${stateLabel}`;
    durationFilterToggleBtn.setAttribute("aria-pressed", String(durationFilteringEnabled));
    durationFilterToggleBtn.title = durationFilteringEnabled
        ? "Disable duration filtering"
        : "Enable duration filtering";
}

function getFilters() {
    return {
        calendarIds: Array.from(selectedCalendarIds),
        allDayOnly: allDayOnlyEnabled,
        calendarAllDayModes,
        getMinDurationMs: getEffectiveMinDurationMs
    };
}

// Recomputes the "Filtered out X of Y" stats for the currently visible year.
async function updateFilterStats() {
    const year = currentYear;
    const { stats } = await eventStore.getFilteredEvents(year, year, getFilters());
    if (year !== currentYear) return; // Stale; a newer call is in flight.
    lastFilterStats = stats;
    updateSelectedSummary();
}

// Called whenever any event-affecting filter changes.
function applyFilterChange() {
    gridView.refreshEvents();
    updateFilterStats();
}

// ---------------------------------------------------------------------------
// Year navigation
// ---------------------------------------------------------------------------

function clampYear(value) {
    return Math.min(YEAR_MAX, Math.max(YEAR_MIN, value));
}

function jumpToYear(year) {
    gridView.showYear(clampYear(year));
}

// ---------------------------------------------------------------------------
// Calendar sidebar
// ---------------------------------------------------------------------------

function createCalendarChip(cal) {
    const chip = document.createElement("button");
    chip.type = "button";
    const calendarName = cal.name || "(unnamed)";
    const isSelected = selectedCalendarIds.has(cal.id);
    chip.className = `cal-chip calendar-select-chip${isSelected ? " selected" : ""}`;
    chip.textContent = calendarName;
    chip.title = calendarName;
    chip.setAttribute("aria-label", calendarName);
    chip.setAttribute("aria-pressed", String(isSelected));
    chip.addEventListener("click", () => {
        if (selectedCalendarIds.has(cal.id)) {
            selectedCalendarIds.delete(cal.id);
        } else {
            selectedCalendarIds.add(cal.id);
        }
        persistSelection(selectedCalendarIds);
        renderCalendarList(availableCalendars);
        applyFilterChange();
    });
    return chip;
}

function createAllDayModeButton(cal) {
    const calendarName = cal.name || "(unnamed)";
    const modeButton = document.createElement("button");
    modeButton.type = "button";
    const mode = getCalendarAllDayMode(cal.id);
    modeButton.className = "btn calendar-mode-toggle";
    modeButton.dataset.mode = mode;
    modeButton.textContent = CALENDAR_ALL_DAY_MODE_SYMBOLS[mode] || "x";
    modeButton.title = `${calendarName}: ${getCalendarAllDayModeLabel(mode)}`;
    modeButton.setAttribute("aria-label", `${calendarName}: ${getCalendarAllDayModeLabel(mode)}`);
    modeButton.addEventListener("click", () => {
        calendarAllDayModes[cal.id] = cycleCalendarAllDayMode(getCalendarAllDayMode(cal.id));
        persistCalendarAllDayModes(calendarAllDayModes);
        renderCalendarList(availableCalendars);
        applyFilterChange();
    });
    return modeButton;
}

function createDurationControl(cal) {
    const calendarName = cal.name || "(unnamed)";
    const hint = `${calendarName}: minimum event length in hours. Set to -1 to follow the global duration filter.`;

    const durationControl = document.createElement("label");
    durationControl.className = "calendar-duration-control";
    durationControl.title = hint;

    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "-1";
    durationInput.step = "0.25";
    durationInput.className = "input calendar-duration-input";
    durationInput.value = String(getCalendarMinDurationHours(cal.id));
    durationInput.title = hint;
    durationInput.setAttribute("aria-label", `${calendarName}: minimum event length in hours. Use -1 to follow the global duration filter.`);

    const applyCalendarDuration = async () => {
        durationInput.value = String(setCalendarMinDurationHours(cal.id, durationInput.value));
        await persistCalendarMinDurationHours(calendarMinDurationHours);
        applyFilterChange();
    };
    durationInput.addEventListener("change", applyCalendarDuration);

    const makeStepButton = (delta) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn calendar-duration-step";
        btn.dataset.size = "compact";
        btn.textContent = delta > 0 ? "+" : "–";
        const verb = delta > 0 ? "increase" : "decrease";
        btn.title = `${calendarName}: ${verb} minimum event length by one hour`;
        btn.setAttribute("aria-label", btn.title);
        btn.addEventListener("click", async () => {
            const current = Number(durationInput.value);
            const next = Math.max(-1, (Number.isNaN(current) ? -1 : current) + delta);
            durationInput.value = String(Math.round(next * 100) / 100);
            await applyCalendarDuration();
        });
        return btn;
    };

    durationControl.appendChild(durationInput);
    durationControl.appendChild(makeStepButton(-1));
    durationControl.appendChild(makeStepButton(1));
    return durationControl;
}

function renderCalendarList(calendars) {
    calendarList.innerHTML = "";
    calendars.forEach((cal) => {
        const row = document.createElement("div");
        row.className = "calendar-row";
        row.appendChild(createCalendarChip(cal));
        row.appendChild(createAllDayModeButton(cal));
        row.appendChild(createDurationControl(cal));
        calendarList.appendChild(row);
    });
    updateSelectedSummary();
}

function setAllCalendars(selected) {
    if (!availableCalendars.length) return;
    selectedCalendarIds = selected ? new Set(availableCalendars.map((c) => c.id)) : new Set();
    renderCalendarList(availableCalendars);
    persistSelection(selectedCalendarIds);
    applyFilterChange();
}

function updateSelectedSummary() {
    if (!selectedSummary) return;
    const selected = availableCalendars.filter((c) => selectedCalendarIds.has(c.id));
    const filterText = lastFilterStats.filteredOut > 0
        ? `Filtered out ${lastFilterStats.filteredOut} of ${lastFilterStats.total}`
        : "";

    if (!selected.length) {
        selectedSummary.textContent = "No calendars selected";
        selectedSummary.title = "No calendars selected";
        return;
    }

    const base = `Showing ${selected.length} of ${availableCalendars.length} calendars`;
    selectedSummary.textContent = filterText ? `${base} · ${filterText}` : base;
    selectedSummary.title = selected.map((c) => c.name || "(unnamed)").join(", ");
}

function setCalendarPanelVisible(expanded) {
    if (!calendarFilters || !toggleCalendarsBtn) return;
    calendarFilters.classList.toggle("collapsed", !expanded);
    yearLayout?.classList.toggle("sidebar-collapsed", !expanded);
    toggleCalendarsBtn.setAttribute("aria-expanded", String(expanded));
    toggleCalendarsBtn.textContent = expanded ? "Hide options" : "Show options";
    persistPanelState(expanded);
}

async function loadCalendars() {
    availableCalendars = await fetchCalendars();
    const { ids: persistedIds, found } = await loadPersistedSelection();
    const { modes } = await loadCalendarAllDayModes();
    const { hours } = await loadCalendarMinDurationHours();

    selectedCalendarIds = found
        ? new Set(availableCalendars.filter((c) => persistedIds.has(c.id)).map((c) => c.id))
        : new Set(availableCalendars.map((c) => c.id));
    calendarAllDayModes = modes;
    calendarMinDurationHours = hours;

    renderCalendarList(availableCalendars);
    await persistSelection(selectedCalendarIds);
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refreshCalendarData() {
    if (isRefreshing) return;
    isRefreshing = true;
    refreshButton?.classList.add("refreshing");
    try {
        eventStore.invalidate();
        await loadCalendars();
        applyFilterChange();
    } catch (err) {
        console.error("[refresh] Refresh failed", err);
    } finally {
        isRefreshing = false;
        refreshButton?.classList.remove("refreshing");
    }
}

function setupAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
    if (refreshSettings.autoRefreshEnabled) {
        autoRefreshTimer = setInterval(refreshCalendarData, refreshSettings.autoRefreshInterval);
    }
}

function setupTabFocusRefresh() {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            refreshCalendarData();
        }
    });
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function setThemeMode(mode) {
    themeMode = mode === "light" || mode === "dark" ? mode : "auto";
    if (systemThemeWatcher) {
        systemThemeWatcher.removeEventListener("change", handleSystemThemeChange);
        systemThemeWatcher = null;
    }
    if (themeMode === "auto" && window.matchMedia) {
        systemThemeWatcher = window.matchMedia("(prefers-color-scheme: dark)");
        systemThemeWatcher.addEventListener("change", handleSystemThemeChange);
    }
    applyResolvedTheme();
    persistTheme(themeMode);
}

function handleSystemThemeChange() {
    if (themeMode === "auto") {
        applyResolvedTheme();
    }
}

function applyResolvedTheme() {
    const resolved = themeMode === "auto" ? detectSystemMode() : themeMode;
    applyTheme(resolved);
    if (themeToggleBtn) {
        const label = themeMode === "auto" ? `Theme: Auto (${resolved})` : `Theme: ${resolved}`;
        const next = themeMode === "auto" ? "Light" : themeMode === "light" ? "Dark" : "Auto";
        themeToggleBtn.textContent = `${label} → ${next}`;
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function adjustMinDuration(deltaHours) {
    if (!minDurationInput) return;
    const current = Number(minDurationInput.value);
    const next = Math.max(0, (Number.isNaN(current) ? 0 : current) + deltaHours);
    minDurationInput.value = String(Math.round(next * 100) / 100);
    await persistMinDurationPreference(next);
    applyFilterChange();
}

async function init() {
    setThemeMode(await loadThemePreference());
    refreshSettings = await loadRefreshSettings();

    if (minDurationInput) {
        minDurationInput.value = String(await loadMinDurationPreference());
    }
    allDayOnlyEnabled = await loadAllDayOnlyPreference();
    if (allDayOnlyInput) {
        allDayOnlyInput.checked = allDayOnlyEnabled;
    }
    if (showWeekNumbersInput) {
        showWeekNumbersInput.checked = await loadWeekNumbersPreference();
    }
    viewMode = await loadViewMode();
    if (viewModeSelect) {
        viewModeSelect.value = viewMode;
    }
    grayPastDaysEnabled = await loadGrayPastDays();
    highlightCurrentDayEnabled = await loadHighlightCurrentDay();
    if (grayPastDaysInput) grayPastDaysInput.checked = grayPastDaysEnabled;
    if (highlightCurrentDayInput) highlightCurrentDayInput.checked = highlightCurrentDayEnabled;

    await loadCalendars();

    yearInput.value = currentYear;
    gridView.setMode(viewMode, { anchorYear: currentYear });
    updateFilterStats();
    setupAutoRefresh();
    setupTabFocusRefresh();

    onChange(yearInput, () => {
        const nextYear = Number(yearInput.value);
        if (Number.isFinite(nextYear)) {
            jumpToYear(nextYear);
        }
    });

    yearButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const step = Number(btn.dataset.yearStep) || 0;
            jumpToYear(currentYear + step);
        });
    });

    onClick(todayButton, () => gridView.showToday());

    onChange(viewModeSelect, async () => {
        viewMode = viewModeSelect?.value || "linear";
        await persistViewMode(viewMode);
        gridView.setMode(viewMode);
    });

    onChange(allDayOnlyInput, async () => {
        allDayOnlyEnabled = allDayOnlyInput?.checked || false;
        await persistAllDayOnlyPreference(allDayOnlyEnabled);
        applyFilterChange();
    });
    onChange(minDurationInput, async () => {
        await persistMinDurationPreference(getGlobalMinDurationHours());
        applyFilterChange();
    });
    onClick(minDurationDownBtn, () => adjustMinDuration(-1));
    onClick(minDurationUpBtn, () => adjustMinDuration(1));
    onClick(durationFilterToggleBtn, () => {
        durationFilteringEnabled = !durationFilteringEnabled;
        updateDurationFilterToggleLabel();
        applyFilterChange();
    });
    onClick(selectAllBtn, () => setAllCalendars(true));
    onClick(deselectAllBtn, () => setAllCalendars(false));

    onChange(showWeekNumbersInput, () => {
        persistWeekNumbersPreference(showWeekNumbersInput.checked);
        gridView.rebuild();
    });
    onChange(grayPastDaysInput, async () => {
        grayPastDaysEnabled = grayPastDaysInput?.checked || false;
        await persistGrayPastDays(grayPastDaysEnabled);
        gridView.rebuild();
    });
    onChange(highlightCurrentDayInput, async () => {
        highlightCurrentDayEnabled = highlightCurrentDayInput?.checked || false;
        await persistHighlightCurrentDay(highlightCurrentDayEnabled);
        gridView.rebuild();
    });

    if (toggleCalendarsBtn) {
        onClick(toggleCalendarsBtn, () => {
            const isExpanded = toggleCalendarsBtn.getAttribute("aria-expanded") === "true";
            setCalendarPanelVisible(!isExpanded);
        });
        setCalendarPanelVisible(await loadPanelState());
    }

    onClick(refreshButton, () => refreshCalendarData());

    onClick(themeToggleBtn, () => {
        const modes = ["auto", "light", "dark"];
        setThemeMode(modes[(modes.indexOf(themeMode) + 1) % modes.length]);
    });

    updateDurationFilterToggleLabel();
}

document.addEventListener("DOMContentLoaded", init);
