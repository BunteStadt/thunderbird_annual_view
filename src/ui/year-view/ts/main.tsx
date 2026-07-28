import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchCalendars } from "./calendar-service";
import { EventStore } from "./event-store";
import { GridView } from "./grid-view";
import {
  loadAllDayOnlyPreference,
  loadCalendarAllDayModes,
  loadCalendarMinDurationHours,
  loadGrayPastDays,
  loadHighlightCurrentDay,
  loadMinDurationPreference,
  loadPanelState,
  loadPersistedSelection,
  loadRefreshSettings,
  loadThemePreference,
  loadViewMode,
  loadWeekNumbersPreference,
  persistAllDayOnlyPreference,
  persistCalendarAllDayModes,
  persistCalendarMinDurationHours,
  persistGrayPastDays,
  persistHighlightCurrentDay,
  persistMinDurationPreference,
  persistPanelState,
  persistSelection,
  persistTheme,
  persistViewMode,
  persistWeekNumbersPreference
} from "./storage";
import { applyTheme, detectSystemMode } from "./theme";
import type {
  CalendarAllDayMode,
  CalendarFilters,
  CalendarInfo,
  FilterStats,
  RefreshSettings,
  ThemeMode,
  ViewMode
} from "./types";

if (typeof globalThis.ENABLE_DUMMY_CALENDARS !== "boolean") {
  const dummyParam = new URLSearchParams(globalThis.location?.search || "").get("dummy");
  globalThis.ENABLE_DUMMY_CALENDARS = dummyParam === "" || dummyParam === "1" || dummyParam === "true";
}

const CALENDAR_ALL_DAY_MODE_SYMBOLS: Record<CalendarAllDayMode, string> = { yes: "✓", no: "x", follow: "-" };
const YEAR_MIN = 1900;
const YEAR_MAX = 2999;

function getCalendarAllDayModeLabel(mode: CalendarAllDayMode) {
  if (mode === "yes") return "all-day only yes";
  if (mode === "no") return "all-day only no";
  return "follow global all-day setting";
}

function clampYear(value: number) {
  return Math.min(YEAR_MAX, Math.max(YEAR_MIN, value));
}

function App() {
  const eventStoreRef = useRef(new EventStore());
  const gridViewRef = useRef<GridView | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLElement | null>(null);

  const [availableCalendars, setAvailableCalendars] = useState<CalendarInfo[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [calendarAllDayModes, setCalendarAllDayModes] = useState<Record<string, CalendarAllDayMode>>({});
  const [calendarMinDurationHours, setCalendarMinDurationHours] = useState<Record<string, number>>({});

  const [allDayOnlyEnabled, setAllDayOnlyEnabled] = useState(false);
  const [durationFilteringEnabled, setDurationFilteringEnabled] = useState(true);
  const [globalMinDurationHours, setGlobalMinDurationHours] = useState(25);
  const [showWeekNumbers, setShowWeekNumbers] = useState(true);
  const [grayPastDaysEnabled, setGrayPastDaysEnabled] = useState(false);
  const [highlightCurrentDayEnabled, setHighlightCurrentDayEnabled] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [refreshSettings, setRefreshSettings] = useState<RefreshSettings>({ autoRefreshEnabled: true, autoRefreshInterval: 300000 });
  const [viewMode, setViewMode] = useState<ViewMode>("linear");
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));
  const [lastFilterStats, setLastFilterStats] = useState<FilterStats>({ filteredOut: 0, total: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const getCalendarAllDayMode = useCallback((calendarId: string): CalendarAllDayMode => {
    const mode = calendarAllDayModes[calendarId];
    return mode === "yes" || mode === "no" || mode === "follow" ? mode : "follow";
  }, [calendarAllDayModes]);

  const getCalendarMinDurationHours = useCallback((calendarId: string) => {
    const hours = Number(calendarMinDurationHours[calendarId]);
    return Number.isFinite(hours) && hours >= 0 ? hours : -1;
  }, [calendarMinDurationHours]);

  const getEffectiveMinDurationMs = useCallback((calendarId: string) => {
    if (!durationFilteringEnabled) return 0;
    const overrideHours = getCalendarMinDurationHours(calendarId);
    const effectiveHours = overrideHours >= 0 ? overrideHours : globalMinDurationHours;
    return effectiveHours > 0 ? effectiveHours * 60 * 60 * 1000 : 0;
  }, [durationFilteringEnabled, getCalendarMinDurationHours, globalMinDurationHours]);

  const filters = useMemo<CalendarFilters>(() => ({
    calendarIds: Array.from(selectedCalendarIds),
    allDayOnly: durationFilteringEnabled ? allDayOnlyEnabled : false,
    calendarAllDayModes: durationFilteringEnabled ? calendarAllDayModes : {},
    getMinDurationMs: durationFilteringEnabled ? getEffectiveMinDurationMs : () => 0
  }), [allDayOnlyEnabled, calendarAllDayModes, durationFilteringEnabled, getEffectiveMinDurationMs, selectedCalendarIds]);

  const updateFilterStats = useCallback(async (year: number = currentYear) => {
    const { stats } = await eventStoreRef.current.getFilteredEvents(year, year, filters);
    setLastFilterStats(stats);
  }, [currentYear, filters]);

  const applyFilterChange = useCallback(() => {
    gridViewRef.current?.refreshEvents();
    void updateFilterStats();
  }, [updateFilterStats]);

  const loadCalendars = useCallback(async () => {
    const calendars = await fetchCalendars();
    const { ids: persistedIds, found } = await loadPersistedSelection();
    const { modes } = await loadCalendarAllDayModes();
    const { hours } = await loadCalendarMinDurationHours();

    const selectedIds = found
      ? new Set(calendars.filter((c) => persistedIds.has(c.id)).map((c) => c.id))
      : new Set(calendars.map((c) => c.id));

    setAvailableCalendars(calendars);
    setSelectedCalendarIds(selectedIds);
    setCalendarAllDayModes(modes as Record<string, CalendarAllDayMode>);
    setCalendarMinDurationHours(hours);
    await persistSelection(selectedIds);
  }, []);

  const refreshCalendarData = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      eventStoreRef.current.invalidate();
      await loadCalendars();
      applyFilterChange();
    } catch (err) {
      console.error("[refresh] Refresh failed", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [applyFilterChange, isRefreshing, loadCalendars]);

  useEffect(() => {
    if (!viewportRef.current || !headerRef.current || !rowsRef.current || gridViewRef.current) return;

    const grid = new GridView({
      viewport: viewportRef.current,
      header: headerRef.current,
      rowsContainer: rowsRef.current,
      eventStore: eventStoreRef.current,
      getOptions: () => ({
        showWeekNumbers,
        grayPastDays: grayPastDaysEnabled,
        highlightCurrentDay: highlightCurrentDayEnabled,
        filters
      }),
      onYearChange: (year: number) => {
        setCurrentYear(year);
        setYearInput(String(year));
      }
    });

    gridViewRef.current = grid;
  }, [filters, grayPastDaysEnabled, highlightCurrentDayEnabled, showWeekNumbers]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [
        theme,
        minDuration,
        allDayOnly,
        weekNumbers,
        panel,
        refresh,
        grayPast,
        highlightCurrent,
        initialViewMode
      ] = await Promise.all([
        loadThemePreference(),
        loadMinDurationPreference(),
        loadAllDayOnlyPreference(),
        loadWeekNumbersPreference(),
        loadPanelState(),
        loadRefreshSettings(),
        loadGrayPastDays(),
        loadHighlightCurrentDay(),
        loadViewMode()
      ]);

      if (!mounted) return;

      setThemeMode(theme as ThemeMode);
      setGlobalMinDurationHours(minDuration);
      setAllDayOnlyEnabled(allDayOnly);
      setShowWeekNumbers(weekNumbers);
      setPanelExpanded(panel);
      setRefreshSettings(refresh);
      setGrayPastDaysEnabled(grayPast);
      setHighlightCurrentDayEnabled(highlightCurrent);
      setViewMode(initialViewMode as ViewMode);

      await loadCalendars();
      if (!mounted) return;

      const grid = gridViewRef.current;
      grid?.setMode(initialViewMode as ViewMode, { anchorYear: currentYear });
      void updateFilterStats(currentYear);
    })();

    return () => {
      mounted = false;
    };
  }, [currentYear, loadCalendars, updateFilterStats]);

  useEffect(() => {
    const resolved = themeMode === "auto" ? detectSystemMode() : themeMode;
    applyTheme(resolved);
    void persistTheme(themeMode);

    if (themeMode !== "auto" || !window.matchMedia) return;
    const watcher = window.matchMedia("(prefers-color-scheme: dark)");
    const handle = () => applyTheme(watcher.matches ? "dark" : "light");
    watcher.addEventListener("change", handle);
    return () => watcher.removeEventListener("change", handle);
  }, [themeMode]);

  useEffect(() => {
    if (!gridViewRef.current) return;
    gridViewRef.current.rebuild();
  }, [showWeekNumbers, grayPastDaysEnabled, highlightCurrentDayEnabled]);

  useEffect(() => {
    if (!gridViewRef.current) return;
    gridViewRef.current.setMode(viewMode, { anchorYear: currentYear });
    void persistViewMode(viewMode);
  }, [currentYear, viewMode]);

  useEffect(() => {
    applyFilterChange();
  }, [applyFilterChange, filters]);

  useEffect(() => {
    if (!refreshSettings.autoRefreshEnabled) return;
    const timer = window.setInterval(() => {
      void refreshCalendarData();
    }, refreshSettings.autoRefreshInterval);
    return () => window.clearInterval(timer);
  }, [refreshCalendarData, refreshSettings.autoRefreshEnabled, refreshSettings.autoRefreshInterval]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshCalendarData();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshCalendarData]);

  const selectedCalendars = useMemo(
    () => availableCalendars.filter((c) => selectedCalendarIds.has(c.id)),
    [availableCalendars, selectedCalendarIds]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedCalendars.length) return "No calendars selected";
    const base = `Showing ${selectedCalendars.length} of ${availableCalendars.length} calendars`;
    return lastFilterStats.filteredOut > 0
      ? `${base} · Filtered out ${lastFilterStats.filteredOut} of ${lastFilterStats.total}`
      : base;
  }, [availableCalendars.length, lastFilterStats.filteredOut, lastFilterStats.total, selectedCalendars.length]);

  const toggleCalendar = async (calendarId: string) => {
    const next = new Set(selectedCalendarIds);
    if (next.has(calendarId)) next.delete(calendarId);
    else next.add(calendarId);
    setSelectedCalendarIds(next);
    await persistSelection(next);
  };

  const cycleCalendarAllDayMode = async (calendarId: string) => {
    const mode = getCalendarAllDayMode(calendarId);
    const nextMode: CalendarAllDayMode = mode === "yes" ? "no" : mode === "no" ? "follow" : "yes";
    const next = { ...calendarAllDayModes, [calendarId]: nextMode };
    setCalendarAllDayModes(next);
    await persistCalendarAllDayModes(next);
  };

  const setCalendarDuration = async (calendarId: string, value: number) => {
    const next = { ...calendarMinDurationHours };
    if (!Number.isFinite(value) || value < 0) {
      delete next[calendarId];
    } else {
      next[calendarId] = Math.round(value * 100) / 100;
    }
    setCalendarMinDurationHours(next);
    await persistCalendarMinDurationHours(next);
  };

  const jumpToYear = (year: number) => {
    const nextYear = clampYear(year);
    setCurrentYear(nextYear);
    setYearInput(String(nextYear));
    gridViewRef.current?.showYear(nextYear);
  };

  const durationFilterLabel = `⏱ Duration filter: ${durationFilteringEnabled ? "On" : "Off"}`;
  const themeLabel = themeMode === "auto" ? `Theme: Auto (${detectSystemMode()})` : `Theme: ${themeMode}`;
  const nextTheme = themeMode === "auto" ? "light" : themeMode === "light" ? "dark" : "auto";

  return (
    <>
      <header>
        <div className="controls" role="toolbar" aria-label="Calendar annual view controls">
          <button
            id="toggleCalendars"
            className="btn"
            data-size="compact"
            type="button"
            aria-expanded={panelExpanded}
            aria-controls="calendarFilters"
            onClick={async () => {
              const expanded = !panelExpanded;
              setPanelExpanded(expanded);
              await persistPanelState(expanded);
            }}
          >
            {panelExpanded ? "Hide options" : "Show options"}
          </button>

          <div className="year-nav" aria-label="Year navigation">
            <button className="btn" type="button" data-size="compact" onClick={() => jumpToYear(currentYear - 1)}>–</button>
            <input
              id="yearInput"
              className="input"
              type="number"
              min={YEAR_MIN}
              max={YEAR_MAX}
              step={1}
              value={yearInput}
              onChange={(event) => setYearInput(event.target.value)}
              onBlur={() => {
                const nextYear = Number(yearInput);
                if (Number.isFinite(nextYear)) jumpToYear(nextYear);
                else setYearInput(String(currentYear));
              }}
              aria-label="Target year"
            />
            <button className="btn" type="button" data-size="compact" onClick={() => jumpToYear(currentYear + 1)}>+</button>
            <button id="todayButton" className="btn" data-size="compact" type="button" onClick={() => gridViewRef.current?.showToday()}>Today</button>
          </div>

          <label htmlFor="viewMode" className="view-mode-label">
            <span>View:</span>
            <select
              id="viewMode"
              className="input input-compact"
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as ViewMode)}
            >
              <option value="linear">compact</option>
              <option value="day-aligned">aligned</option>
              <option value="week-rows">4-week</option>
              <option value="two-week-rows">2-week</option>
              <option value="one-week-rows">1-week</option>
            </select>
          </label>

          <button
            id="durationFilterToggle"
            className="btn"
            data-size="compact"
            type="button"
            aria-pressed={durationFilteringEnabled}
            onClick={() => setDurationFilteringEnabled((value) => !value)}
          >
            {durationFilterLabel}
          </button>

          <div id="selectedSummary" className="selected-summary" aria-live="polite" title={selectedCalendars.map((c) => c.name || "(unnamed)").join(", ")}>
            {selectedSummary}
          </div>

          <button id="refreshButton" className={`btn ${isRefreshing ? "refreshing" : ""}`} data-size="compact" type="button" onClick={() => void refreshCalendarData()}>
            ⟳ Refresh
          </button>
          <button
            id="themeToggle"
            className="btn"
            data-size="compact"
            type="button"
            onClick={() => setThemeMode(nextTheme)}
          >
            {`${themeLabel} → ${nextTheme[0].toUpperCase()}${nextTheme.slice(1)}`}
          </button>
        </div>
      </header>

      <div id="yearLayout" className={`year-layout${panelExpanded ? "" : " sidebar-collapsed"}`}>
        <aside id="calendarFilters" className={`calendar-filters${panelExpanded ? "" : " collapsed"}`} aria-label="Calendar filters">
          <div className="cal-actions">
            <label htmlFor="showWeekNumbers" className="btn cal-chip-toggle" data-size="compact">
              <input id="showWeekNumbers" type="checkbox" checked={showWeekNumbers} onChange={async (event) => {
                setShowWeekNumbers(event.target.checked);
                await persistWeekNumbersPreference(event.target.checked);
              }} />
              <span className="chip-indicator" aria-hidden="true" />
              <span className="chip-text">Show week numbers</span>
            </label>
            <label htmlFor="grayPastDays" className="btn cal-chip-toggle" data-size="compact">
              <input id="grayPastDays" type="checkbox" checked={grayPastDaysEnabled} onChange={async (event) => {
                setGrayPastDaysEnabled(event.target.checked);
                await persistGrayPastDays(event.target.checked);
              }} />
              <span className="chip-indicator" aria-hidden="true" />
              <span className="chip-text">Gray out past days</span>
            </label>
            <label htmlFor="highlightCurrentDay" className="btn cal-chip-toggle" data-size="compact">
              <input id="highlightCurrentDay" type="checkbox" checked={highlightCurrentDayEnabled} onChange={async (event) => {
                setHighlightCurrentDayEnabled(event.target.checked);
                await persistHighlightCurrentDay(event.target.checked);
              }} />
              <span className="chip-indicator" aria-hidden="true" />
              <span className="chip-text">Highlight current day</span>
            </label>
            <div className="separator" />
            <div id="durationFiltersNotice" className="duration-filters-notice" hidden={durationFilteringEnabled}>
              Duration filter is off. All-day and duration options below are inactive.
            </div>
            <label htmlFor="allDayOnly" className={`btn cal-chip-toggle${durationFilteringEnabled ? "" : " filter-overridden"}`} data-size="compact">
              <input id="allDayOnly" type="checkbox" checked={allDayOnlyEnabled} disabled={!durationFilteringEnabled} onChange={async (event) => {
                setAllDayOnlyEnabled(event.target.checked);
                await persistAllDayOnlyPreference(event.target.checked);
              }} />
              <span className="chip-indicator" aria-hidden="true" />
              <span className="chip-text">Show all-day only</span>
            </label>
            <label htmlFor="minDurationHours" className={`cal-chip${durationFilteringEnabled ? "" : " filter-overridden"}`}>
              <span>Min event length (h)</span>
              <input
                id="minDurationHours"
                className="input"
                type="number"
                min={0}
                step={0.25}
                value={globalMinDurationHours}
                disabled={!durationFilteringEnabled}
                onChange={async (event) => {
                  const value = Math.max(0, Number(event.target.value) || 0);
                  setGlobalMinDurationHours(value);
                  await persistMinDurationPreference(value);
                }}
              />
              <div className="min-duration-controls">
                <button id="minDurationDown" className="btn" data-size="compact" type="button" disabled={!durationFilteringEnabled} onClick={async () => {
                  const next = Math.max(0, globalMinDurationHours - 1);
                  setGlobalMinDurationHours(next);
                  await persistMinDurationPreference(next);
                }}>–</button>
                <button id="minDurationUp" className="btn" data-size="compact" type="button" disabled={!durationFilteringEnabled} onClick={async () => {
                  const next = Math.max(0, globalMinDurationHours + 1);
                  setGlobalMinDurationHours(next);
                  await persistMinDurationPreference(next);
                }}>+</button>
              </div>
            </label>
            <div className="select-buttons">
              <button id="selectAllCals" className="btn" data-size="compact" type="button" onClick={async () => {
                const next = new Set(availableCalendars.map((c) => c.id));
                setSelectedCalendarIds(next);
                await persistSelection(next);
              }}>Select all</button>
              <button id="deselectAllCals" className="btn" data-size="compact" type="button" onClick={async () => {
                const next = new Set<string>();
                setSelectedCalendarIds(next);
                await persistSelection(next);
              }}>Deselect all</button>
            </div>
          </div>

          <div className="cal-list-head" aria-hidden="true">
            <span>Calendar</span>
            <span>All-day</span>
            <span>Min event length</span>
          </div>

          <div className={`cal-list${durationFilteringEnabled ? "" : " duration-filters-inactive"}`} id="calendarList" aria-label="Calendars">
            {availableCalendars.map((cal) => {
              const isSelected = selectedCalendarIds.has(cal.id);
              const mode = getCalendarAllDayMode(cal.id);
              return (
                <div className="calendar-row" key={cal.id}>
                  <button
                    type="button"
                    className={`cal-chip calendar-select-chip${isSelected ? " selected" : ""}`}
                    aria-pressed={isSelected}
                    title={cal.name || "(unnamed)"}
                    onClick={() => void toggleCalendar(cal.id)}
                  >
                    {cal.name || "(unnamed)"}
                  </button>
                  <button
                    type="button"
                    className={`btn calendar-mode-toggle${durationFilteringEnabled ? "" : " filter-overridden"}`}
                    data-mode={mode}
                    disabled={!durationFilteringEnabled}
                    title={`${cal.name || "(unnamed)"}: ${getCalendarAllDayModeLabel(mode)}`}
                    onClick={() => void cycleCalendarAllDayMode(cal.id)}
                  >
                    {CALENDAR_ALL_DAY_MODE_SYMBOLS[mode] || "x"}
                  </button>
                  <label className={`calendar-duration-control${durationFilteringEnabled ? "" : " filter-overridden"}`}>
                    <input
                      className="input calendar-duration-input"
                      type="number"
                      min={-1}
                      step={0.25}
                      value={getCalendarMinDurationHours(cal.id)}
                      disabled={!durationFilteringEnabled}
                      onChange={(event) => {
                        void setCalendarDuration(cal.id, Number(event.target.value));
                      }}
                    />
                    <button
                      type="button"
                      className="btn calendar-duration-step"
                      data-size="compact"
                      disabled={!durationFilteringEnabled}
                      onClick={() => {
                        const current = getCalendarMinDurationHours(cal.id);
                        void setCalendarDuration(cal.id, Math.max(-1, current - 1));
                      }}
                    >
                      –
                    </button>
                    <button
                      type="button"
                      className="btn calendar-duration-step"
                      data-size="compact"
                      disabled={!durationFilteringEnabled}
                      onClick={() => {
                        const current = getCalendarMinDurationHours(cal.id);
                        void setCalendarDuration(cal.id, Math.max(-1, current + 1));
                      }}
                    >
                      +
                    </button>
                  </label>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="main-panel">
          <div className="calendar-wrap">
            <div ref={viewportRef} id="gridViewport" className="grid-viewport" aria-label="Scrollable annual calendar">
              <div ref={headerRef} id="gridHeader" className="grid-header hidden" aria-hidden="true" />
              <section ref={rowsRef} id="gridRows" className="calendar-rows" aria-label="Calendar months" />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

const rootElement = document.getElementById("app");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
