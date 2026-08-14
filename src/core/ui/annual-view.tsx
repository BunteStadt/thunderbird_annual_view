import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Menu, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { initApp } from "../app.js";
import "./year-view.css";

export type YearViewConfig = Record<string, unknown>;

function YearViewShell({ embeddedDemo = false }: { embeddedDemo?: boolean }) {
    const [showScrollHint, setShowScrollHint] = useState(false);
    const scrollHintTimerRef = useRef<number | null>(null);
    const gridViewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const gridViewport = gridViewportRef.current;
        if (!embeddedDemo || !gridViewport) return;
        const onWheel = () => {
            setShowScrollHint(true);
            if (scrollHintTimerRef.current !== null) window.clearTimeout(scrollHintTimerRef.current);
            scrollHintTimerRef.current = window.setTimeout(() => setShowScrollHint(false), 3200);
        };
        gridViewport.addEventListener("wheel", onWheel);
        return () => gridViewport.removeEventListener("wheel", onWheel);
    }, [embeddedDemo]);

    useEffect(() => () => {
        if (scrollHintTimerRef.current !== null) window.clearTimeout(scrollHintTimerRef.current);
    }, []);

    return (
        <div className="av-app">
            <header className="av-toolbar"><div className="controls"><div data-ui-slot="header-leading" hidden />
                <button id="toggleCalendars" className="btn" data-size="compact" type="button" aria-expanded="true" aria-controls="calendarFilters">Hide options</button>
                <div className="year-nav"><button className="btn" type="button" data-size="compact" data-year-step="-1">-</button><input id="yearInput" className="input" type="number" min="1900" max="2999" step="1" /><button className="btn" type="button" data-size="compact" data-year-step="1">+</button><button id="todayButton" className="btn" data-size="compact" type="button" title="Jump to the current day">Today</button></div>
                <button id="durationFilterToggle" className="btn" data-size="compact" data-tour="duration-filter" type="button" aria-pressed="true" title="Enable or disable duration and all-day filtering">Duration filter: On</button><div id="selectedSummary" className="selected-summary" aria-live="polite" /><div className="view-settings"><button id="viewSettingsToggle" className="btn icon-button" data-size="compact" type="button" aria-expanded="false" aria-controls="viewSettingsMenu" aria-label="View settings" title="View settings"><Menu aria-hidden="true" /></button><div id="viewSettingsMenu" className="view-settings-menu" role="region" aria-label="View settings" hidden><label htmlFor="viewMode" className="view-mode-label" data-tour="view-mode"><span>View:</span><select id="viewMode" className="input input-compact"><option value="linear">compact</option><option value="day-aligned">aligned</option><option value="week-rows">4-week</option><option value="two-week-rows">2-week</option><option value="one-week-rows">1-week</option></select></label><div className="display-options" data-tour="display-options"><label htmlFor="showWeekNumbers" className="btn cal-chip-toggle" data-size="compact"><input id="showWeekNumbers" type="checkbox" defaultChecked /><span className="chip-indicator" aria-hidden="true" /><span className="chip-text">Show week numbers</span></label><label htmlFor="grayPastDays" className="btn cal-chip-toggle" data-size="compact"><input id="grayPastDays" type="checkbox" /><span className="chip-indicator" aria-hidden="true" /><span className="chip-text">Gray out past days</span></label><label htmlFor="highlightCurrentDay" className="btn cal-chip-toggle" data-size="compact"><input id="highlightCurrentDay" type="checkbox" /><span className="chip-indicator" aria-hidden="true" /><span className="chip-text">Highlight current day</span></label></div><button id="restartTourButton" className="btn" data-size="compact" type="button">Restart tour</button></div></div><button id="refreshButton" className="btn icon-button" data-size="compact" type="button" aria-label="Refresh calendar data" title="Refresh calendar data"><RefreshCw aria-hidden="true" /></button><button id="themeToggle" className="btn icon-button" data-size="compact" type="button" aria-label="Theme: Auto" title="Change theme"><Sun className="theme-icon theme-icon-sun" aria-hidden="true" /><Moon className="theme-icon theme-icon-moon" aria-hidden="true" /><Monitor className="theme-icon theme-icon-auto" aria-hidden="true" /></button><div data-ui-slot="header-actions" hidden />
            </div></header>
            <div id="yearLayout" className="year-layout"><aside id="calendarFilters" className="calendar-filters" aria-label="Calendar filters"><div className="cal-actions"><div className="separator" /><div id="durationFiltersNotice" className="duration-filters-notice" hidden>Duration filter is off. All-day and duration options below are inactive.</div><label htmlFor="allDayOnly" className="btn cal-chip-toggle" data-size="compact" data-tour="global-all-day"><input id="allDayOnly" type="checkbox" /><span className="chip-indicator" aria-hidden="true" /><span className="chip-text">Show all-day only</span></label>
                <label htmlFor="minDurationHours" className="cal-chip" aria-label="Minimum event length in hours" data-tour="global-duration"><span>Min event length (h)</span><input id="minDurationHours" className="input" type="number" min="0" step="0.25" defaultValue="25" title="Minimum event length in hours." /><span className="min-duration-controls"><button id="minDurationDown" className="btn" data-size="compact" type="button" aria-label="Decrease minimum length by one hour">-</button><button id="minDurationUp" className="btn" data-size="compact" type="button" aria-label="Increase minimum length by one hour">+</button></span></label><div className="select-buttons"><button id="selectAllCals" className="btn" data-size="compact" type="button">Select all</button><button id="deselectAllCals" className="btn" data-size="compact" type="button">Deselect all</button></div>
            </div><div className="cal-list-head" aria-hidden="true"><span>Calendar</span><span>All-day</span><span>Min event length</span></div><div className="cal-list" id="calendarList" aria-label="Calendars" data-tour="calendar-list" /><div data-ui-slot="sidebar-sections" /><div data-ui-slot="sidebar-footer" /></aside><main className="main-panel"><div data-ui-slot="content-empty-state" className="content-empty-state" hidden /><div className="calendar-wrap"><div id="gridViewport" ref={gridViewportRef} className="grid-viewport" aria-label="Scrollable annual calendar"><div id="gridHeader" className="grid-header hidden" aria-hidden="true" /><section id="gridRows" className="calendar-rows" aria-label="Calendar months" /></div>{embeddedDemo && <p className={`scroll-hint${showScrollHint ? " is-visible" : ""}`} role="status">Scrolling is enabled on the full page demo.</p>}</div></main></div>
        </div>
    );
}

export function YearView({ config = {} }: { config?: YearViewConfig }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const themeRoot = root.ownerDocument?.documentElement ?? document.documentElement;
        if (!themeRoot) return;
        let disposed = false;
        let api: { destroy?: () => void } | null = null;
        void initApp({ ...config, root, themeRoot }).then((nextApi) => {
            if (disposed) nextApi.destroy?.();
            else api = nextApi;
        }).catch((reason: unknown) => {
            if (!disposed) setError(reason instanceof Error ? reason.message : "Year View could not start.");
        });
        return () => {
            disposed = true;
            api?.destroy?.();
        };
    }, [config]);

    return <div ref={rootRef} className="av-root">{error && <p className="app-error" role="alert">{error}</p>}<YearViewShell embeddedDemo={config.embeddedDemo === true} /></div>;
}

export function mountYearView(element: Element, config: YearViewConfig = {}) {
    const root = createRoot(element);
    root.render(<YearView config={config} />);
    return () => root.unmount();
}