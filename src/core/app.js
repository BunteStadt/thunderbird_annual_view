import { fetchCalendars, getCalendarProvider } from "./providers/calendar-service.js";
import { EventStore } from "./domain/event-store.js";
import { GridView } from "./ui/grid-view.js";
import { setupIcsCalendarIntegration } from "./ics-calendar-integration.js";
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
    loadThemePreference,
    persistTheme,
    loadWeekNumbersPreference,
    persistWeekNumbersPreference,
    loadRefreshSettings,
    loadPanelState,
    persistPanelState,
    loadGrayPastDays,
    persistGrayPastDays,
    loadHighlightCurrentDay,
    persistHighlightCurrentDay,
    loadViewMode,
    persistViewMode
} from "./storage.js";
import { applyTheme, detectSystemMode } from "./ui/theme.js";
import { restartOnboardingTour } from "./ui/onboarding-tour-events.js";

// Builds a map of slot name -> container element from [data-ui-slot] markers.
export function resolveUiSlots(rootDocument) {
    const slots = new Map();
    const elements = rootDocument?.querySelectorAll?.("[data-ui-slot]") ?? [];
    elements.forEach?.((element) => {
        const name = element.getAttribute("data-ui-slot");
        if (name) {
            slots.set(name, element);
        }
    });
    return slots;
}

// Mounts host UI modules into their named slots; unknown slots are skipped.
export function mountUiModules(modules, slots, appApi) {
    const mounted = [];
    for (const module of modules || []) {
        const container = slots.get(module.slot);
        if (!container) {
            console.error("[app] unknown UI slot", module.slot);
            continue;
        }
        mounted.push(module.mount(container, appApi));
    }
    return mounted;
}

// Core application entry point. The host bootstrap builds the config
// (storage adapter, calendar provider, host UI modules) and calls initApp.
export async function initApp(config = {}) {
    const root = config.root ?? document;
    const rootDocument = root.ownerDocument ?? root;
    const isAborted = () => config.signal?.aborted === true;
    const findById = (id) => root.querySelector?.(`#${id}`) ?? null;
    const lifecycle = new AbortController();
    const listenerOptions = { signal: lifecycle.signal };
    // ---------------------------------------------------------------------------
    // DOM references
    // ---------------------------------------------------------------------------

    const gridViewport = findById("gridViewport");
    const gridHeader = findById("gridHeader");
    const gridRows = findById("gridRows");

    const YEAR_MIN = 1900;
    const YEAR_MAX = 2999;

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
    let showWeekNumbersEnabled = true;
    let grayPastDaysEnabled = false;
    let highlightCurrentDayEnabled = false;
    let viewMode = "linear";
    let globalMinDurationHours = 0;
    let icsRemoveCalendar = null;
    let panelExpanded = false;

    function getUiState() {
        return {
            calendars: availableCalendars,
            selectedCalendarIds,
            calendarAllDayModes,
            calendarMinDurationHours,
            expandedCalendarIds,
            allDayOnlyEnabled,
            durationFilteringEnabled,
            globalMinDurationHours,
            filteredOut: lastFilterStats.filteredOut,
            totalEvents: lastFilterStats.total,
            currentYear,
            viewMode,
            showWeekNumbersEnabled,
            grayPastDaysEnabled,
            highlightCurrentDayEnabled,
            themeMode,
            isRefreshing,
            panelExpanded
        };
    }

    function notifyUiState() {
        config.onUiStateChange?.(getUiState());
    }

    const eventStore = new EventStore();
    const gridView = new GridView({
        viewport: gridViewport,
        header: gridHeader,
        rowsContainer: gridRows,
        eventStore,
        getOptions: () => ({
            showWeekNumbers: showWeekNumbersEnabled,
            grayPastDays: grayPastDaysEnabled,
            highlightCurrentDay: highlightCurrentDayEnabled,
            filters: getFilters()
        }),
        onYearChange: (year) => {
            currentYear = year;
            notifyUiState();
            updateFilterStats();
            config.onYearChange?.(year);
        }
    });

    // ---------------------------------------------------------------------------
    // Filters
    // ---------------------------------------------------------------------------

    function hasCalendarOverride(calendarId) {
        return calendarAllDayModes[calendarId] === "yes" || calendarAllDayModes[calendarId] === "no"
            || (Number.isFinite(Number(calendarMinDurationHours[calendarId])) && Number(calendarMinDurationHours[calendarId]) >= 0);
    }

    function getCalendarAllDayMode(calendarId) {
        return calendarAllDayModes[calendarId] === "yes";
    }

    function getCalendarMinDurationHours(calendarId) {
        const hours = Number(calendarMinDurationHours[calendarId]);
        return Number.isFinite(hours) && hours >= 0 ? Math.round(hours) : getGlobalMinDurationHours();
    }

    // Returns the stored value and removes invalid values so the UI represents inheritance explicitly.
    function setCalendarMinDurationHours(calendarId, hours) {
        const duration = Number(hours);
        if (!Number.isFinite(duration) || duration < 0) {
            delete calendarMinDurationHours[calendarId];
            return getGlobalMinDurationHours();
        }
        const nextHours = Math.max(0, Math.round(duration));
        calendarMinDurationHours[calendarId] = nextHours;
        return nextHours;
    }

    function getGlobalMinDurationHours() {
        return globalMinDurationHours;
    }

    function getEffectiveMinDurationMs(calendarId) {
        if (!durationFilteringEnabled) {
            return 0;
        }
        const overrideHours = getCalendarMinDurationHours(calendarId);
        const effectiveHours = overrideHours >= 0 ? overrideHours : getGlobalMinDurationHours();
        return effectiveHours > 0 ? effectiveHours * 60 * 60 * 1000 : 0;
    }

    function getFilters() {
        const durationFiltersActive = durationFilteringEnabled;
        return {
            calendarIds: Array.from(selectedCalendarIds),
            allDayOnly: durationFiltersActive ? allDayOnlyEnabled : false,
            calendarAllDayModes: durationFiltersActive ? calendarAllDayModes : {},
            getMinDurationMs: durationFiltersActive ? getEffectiveMinDurationMs : () => 0
        };
    }

    // Recomputes the "Filtered out X of Y" stats for the currently visible year.
    async function updateFilterStats() {
        const year = currentYear;
        const { stats } = await eventStore.getFilteredEvents(year, year, getFilters());
        if (year !== currentYear) return; // Stale; a newer call is in flight.
        lastFilterStats = stats;
        notifyUiState();
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

    const expandedCalendarIds = new Set();

    function toggleCalendar(calendar, selected) {
        if (selected) selectedCalendarIds.add(calendar.id);
        else selectedCalendarIds.delete(calendar.id);
        void persistSelection(selectedCalendarIds);
        notifyUiState();
        applyFilterChange();
    }

    function toggleCalendarExpanded(calendar) {
        if (expandedCalendarIds.has(calendar.id)) expandedCalendarIds.delete(calendar.id);
        else expandedCalendarIds.add(calendar.id);
        notifyUiState();
    }

    function setCalendarAllDay(calendar, enabled) {
        calendarAllDayModes[calendar.id] = enabled ? "yes" : "no";
        void persistCalendarAllDayModes(calendarAllDayModes);
        notifyUiState();
        applyFilterChange();
    }

    async function setCalendarDuration(calendar, value) {
        setCalendarMinDurationHours(calendar.id, value);
        await persistCalendarMinDurationHours(calendarMinDurationHours);
        notifyUiState();
        applyFilterChange();
    }

    async function stepCalendarDuration(calendar, delta) {
        const current = getCalendarMinDurationHours(calendar.id);
        setCalendarMinDurationHours(calendar.id, current + delta);
        await persistCalendarMinDurationHours(calendarMinDurationHours);
        notifyUiState();
        applyFilterChange();
    }

    function resetCalendarFilters(calendar) {
        delete calendarAllDayModes[calendar.id];
        delete calendarMinDurationHours[calendar.id];
        expandedCalendarIds.delete(calendar.id);
        void persistCalendarAllDayModes(calendarAllDayModes);
        void persistCalendarMinDurationHours(calendarMinDurationHours);
        notifyUiState();
        applyFilterChange();
    }

    function setAllCalendars(selected) {
        if (!availableCalendars.length) return;
        selectedCalendarIds = selected ? new Set(availableCalendars.map((c) => c.id)) : new Set();
        void persistSelection(selectedCalendarIds);
        notifyUiState();
        applyFilterChange();
    }

    async function loadCalendars() {
        availableCalendars = await fetchCalendars();
        if (isAborted()) return;
        const { ids: persistedIds, found } = await loadPersistedSelection();
        const { modes } = await loadCalendarAllDayModes();
        const { hours } = await loadCalendarMinDurationHours();
        if (isAborted()) return;

        if (availableCalendars.length > 0) {
            selectedCalendarIds = config.selectAllCalendars
                ? new Set(availableCalendars.map((calendar) => calendar.id))
                : found
                    ? new Set(availableCalendars.filter((c) => persistedIds.has(c.id)).map((c) => c.id))
                    : new Set(availableCalendars.map((c) => c.id));
        } else if (found) {
            selectedCalendarIds = new Set(persistedIds);
        } else {
            selectedCalendarIds = new Set();
        }
        calendarAllDayModes = modes;
        calendarMinDurationHours = hours;

        if (availableCalendars.length > 0 && !isAborted() && config.demoMode !== true && !found) {
            await persistSelection(selectedCalendarIds);
        }
        notifyUiState();
    }

    // ---------------------------------------------------------------------------
    // Refresh
    // ---------------------------------------------------------------------------

    async function refreshCalendarData() {
        if (isRefreshing) return;
        isRefreshing = true;
        notifyUiState();
        try {
            eventStore.invalidate();
            await loadCalendars();
            applyFilterChange();
        } catch (err) {
            console.error("[refresh] Refresh failed", err);
        } finally {
            isRefreshing = false;
            notifyUiState();
            mountedUiModules.forEach((mounted) => mounted?.update?.());
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

    function clearAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    function setupTabFocusRefresh() {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                refreshCalendarData();
            }
        }, listenerOptions);
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
            systemThemeWatcher.addEventListener("change", handleSystemThemeChange, listenerOptions);
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
        applyTheme(resolved, config.themeRoot);
        gridView.updateEventColors();
        notifyUiState();
    }

    // ---------------------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------------------

    async function adjustMinDuration(deltaHours) {
        globalMinDurationHours = Math.max(0, Math.round((globalMinDurationHours + deltaHours) * 100) / 100);
        await persistMinDurationPreference(globalMinDurationHours);
        notifyUiState();
        applyFilterChange();
    }

    async function init() {
        setThemeMode(await loadThemePreference());
        refreshSettings = await loadRefreshSettings();
        const icsCalendarIntegration = setupIcsCalendarIntegration({
            mount: uiSlots.get("sidebar-footer") ?? null,
            initialCalendars: config.icsCalendars,
            readOnly: config.icsReadOnly === true,
            demoMode: config.demoMode === true,
            onCalendarsChanged: async () => {
                eventStore.invalidate();
                await loadCalendars();
                applyFilterChange();
                mountedUiModules.forEach((mounted) => mounted?.update?.());
            }
        });
        icsRemoveCalendar = (id) => icsCalendarIntegration.removeCalendar(id);

        globalMinDurationHours = Math.round(await loadMinDurationPreference());
        allDayOnlyEnabled = await loadAllDayOnlyPreference();
        showWeekNumbersEnabled = await loadWeekNumbersPreference();
        viewMode = await loadViewMode();
        grayPastDaysEnabled = await loadGrayPastDays();
        highlightCurrentDayEnabled = await loadHighlightCurrentDay();
        panelExpanded = await loadPanelState();
        await icsCalendarIntegration.initialize();

        await loadCalendars();

        if (Number.isFinite(config.initialYear)) {
            currentYear = clampYear(config.initialYear);
        }
        gridView.setMode(viewMode, { anchorYear: currentYear });
        await updateFilterStats();
        setupAutoRefresh();
        setupTabFocusRefresh();
        notifyUiState();
    }


    const uiSlots = resolveUiSlots(root);
    let mountedUiModules = [];
    const appApi = {
        getCalendarProvider,
        refreshCalendars: refreshCalendarData,
        applyFilterChange,
        eventStore,
        listCalendars: () => availableCalendars,
        jumpToYear,
        stepYear: (step) => jumpToYear(currentYear + step),
        showToday: () => gridView.showToday(),
        setViewMode: async (value) => {
            if (!value) return;
            viewMode = value;
            gridView.setMode(value);
            await persistViewMode(value);
            notifyUiState();
        },
        setDisplayOption: async (option, checked) => {
            if (option === "showWeekNumbers") {
                showWeekNumbersEnabled = checked === true;
                await persistWeekNumbersPreference(showWeekNumbersEnabled);
            } else if (option === "grayPastDays") {
                grayPastDaysEnabled = checked === true;
                await persistGrayPastDays(grayPastDaysEnabled);
            } else if (option === "highlightCurrentDay") {
                highlightCurrentDayEnabled = checked === true;
                await persistHighlightCurrentDay(highlightCurrentDayEnabled);
            } else {
                return;
            }
            gridView.updateDisplayOptions();
            notifyUiState();
        },
        setAllDayOnly: async (enabled) => {
            allDayOnlyEnabled = enabled === true;
            await persistAllDayOnlyPreference(allDayOnlyEnabled);
            notifyUiState();
            applyFilterChange();
        },
        setGlobalMinDuration: async (value) => {
            const next = Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
            globalMinDurationHours = Math.round(next * 100) / 100;
            await persistMinDurationPreference(globalMinDurationHours);
            notifyUiState();
            applyFilterChange();
        },
        adjustMinDuration,
        toggleDurationFiltering: () => {
            durationFilteringEnabled = !durationFilteringEnabled;
            notifyUiState();
            applyFilterChange();
        },
        toggleTheme: () => {
            const modes = ["auto", "light", "dark"];
            setThemeMode(modes[(modes.indexOf(themeMode) + 1) % modes.length]);
        },
        restartTour: () => restartOnboardingTour(rootDocument),
        toggleCalendar,
        toggleCalendarExpanded,
        setCalendarAllDay,
        setCalendarDuration,
        stepCalendarDuration,
        resetCalendarFilters,
        removeCalendar: (calendar) => icsRemoveCalendar?.(calendar.id),
        setAllCalendars,
        setPanelExpanded: async (expanded) => {
            panelExpanded = expanded === true;
            await persistPanelState(panelExpanded);
            notifyUiState();
        },
        getCurrentYear: () => currentYear,
        destroy: () => {
            lifecycle.abort();
            clearAutoRefresh();
            if (systemThemeWatcher) {
                systemThemeWatcher.removeEventListener("change", handleSystemThemeChange);
            }
            gridView.destroy?.();
            mountedUiModules.forEach((mounted) => mounted?.destroy?.());
        }
    };
    mountedUiModules = mountUiModules(config.uiModules, uiSlots, appApi);

    await init();
    mountedUiModules.forEach((mounted) => mounted?.update?.());
    return appApi;
}
