import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, ChevronLeft, ChevronRight, Funnel, Menu, Monitor, Moon, RefreshCw, Settings, Sun } from "lucide-react";
import yearViewLogo from "../../../assets/icons/Yearview_logo.svg";
import { initApp } from "../app.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { CalendarList, type CalendarListItem } from "./calendar-list";
import { OnboardingTour } from "./onboarding-tour";
import "./year-view.css";

export type YearViewConfig = Record<string, unknown>;

const VIEW_MODE_LABELS: Record<string, string> = {
    linear: "linear",
    "day-aligned": "day-aligned",
    "week-rows": "four-week-row",
    "two-week-rows": "two-week-row",
    "one-week-rows": "one-week-row"
};

const THEME_MODES = ["auto", "light", "dark"] as const;
type ThemeMode = typeof THEME_MODES[number];

function getNextThemeMode(themeMode: string): ThemeMode {
    const currentIndex = THEME_MODES.indexOf(themeMode as ThemeMode);
    return THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
}

function ThemeActionIcon({ themeMode }: { themeMode: string }) {
    const nextThemeMode = getNextThemeMode(themeMode);
    if (nextThemeMode === "light") return <Sun aria-hidden="true" />;
    if (nextThemeMode === "dark") return <Moon aria-hidden="true" />;
    return <Monitor aria-hidden="true" />;
}

type UiState = {
    calendars: CalendarListItem[];
    selectedCalendarIds: Set<string>;
    calendarAllDayModes: Record<string, string>;
    calendarMinDurationHours: Record<string, number>;
    expandedCalendarIds: Set<string>;
    allDayOnlyEnabled: boolean;
    durationFilteringEnabled: boolean;
    globalMinDurationHours: number;
    filteredOut: number;
    totalEvents: number;
    currentYear: number;
    viewMode: string;
    showWeekNumbersEnabled: boolean;
    grayPastDaysEnabled: boolean;
    highlightCurrentDayEnabled: boolean;
    themeMode: string;
    isRefreshing: boolean;
    panelExpanded: boolean;
};

type AppController = {
    stepYear: (step: number) => void;
    jumpToYear: (year: number) => void;
    showToday: () => void;
    setViewMode: (value: string) => Promise<void>;
    setDisplayOption: (option: string, checked: boolean) => Promise<void>;
    setAllDayOnly: (enabled: boolean) => Promise<void>;
    setGlobalMinDuration: (value: number | string) => Promise<void>;
    adjustMinDuration: (delta: number) => Promise<void>;
    toggleDurationFiltering: () => void;
    toggleTheme: () => void;
    refreshCalendars: () => Promise<void>;
    restartTour: () => void;
    toggleCalendar: (calendar: CalendarListItem, selected: boolean) => void;
    toggleCalendarExpanded: (calendar: CalendarListItem) => void;
    setCalendarAllDay: (calendar: CalendarListItem, enabled: boolean) => void;
    setCalendarDuration: (calendar: CalendarListItem, value: string) => Promise<void>;
    stepCalendarDuration: (calendar: CalendarListItem, delta: number) => Promise<void>;
    resetCalendarFilters: (calendar: CalendarListItem) => void;
    removeCalendar: (calendar: CalendarListItem) => Promise<void> | undefined;
    setAllCalendars: (selected: boolean) => void;
    setPanelExpanded: (expanded: boolean) => Promise<void>;
};

const EMPTY_UI_STATE: UiState = {
    calendars: [],
    selectedCalendarIds: new Set(),
    calendarAllDayModes: {},
    calendarMinDurationHours: {},
    expandedCalendarIds: new Set(),
    allDayOnlyEnabled: false,
    durationFilteringEnabled: true,
    globalMinDurationHours: 0,
    filteredOut: 0,
    totalEvents: 0,
    currentYear: new Date().getFullYear(),
    viewMode: "linear",
    showWeekNumbersEnabled: true,
    grayPastDaysEnabled: false,
    highlightCurrentDayEnabled: false,
    themeMode: "auto",
    isRefreshing: false,
    panelExpanded: false
};

function toggleSwitchFromRowWhitespace(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.querySelector<HTMLElement>('[role="switch"]')?.click();
}

function YearViewShell({ embeddedDemo = false, uiState, controller }: { embeddedDemo?: boolean; uiState: UiState; controller: AppController | null }) {
    const [showScrollHint, setShowScrollHint] = useState(false);
    const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
    const [yearPickerOpen, setYearPickerOpen] = useState(false);
    const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
    const scrollHintTimerRef = useRef<number | null>(null);
    const appRef = useRef<HTMLDivElement>(null);
    const toolbarRef = useRef<HTMLElement>(null);
    const gridViewportRef = useRef<HTMLDivElement>(null);
    const handleViewSettingsChange = (open: boolean) => setViewSettingsOpen(open);

    useLayoutEffect(() => {
        const app = appRef.current;
        const toolbar = toolbarRef.current;
        if (!app || !toolbar) return;
        const updateToolbarHeight = () => {
            app.style.setProperty("--av-toolbar-height", `${toolbar.getBoundingClientRect().height}px`);
        };
        updateToolbarHeight();
        const observer = new ResizeObserver(updateToolbarHeight);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, []);

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

    const selectedCount = uiState.calendars.filter((calendar) => uiState.selectedCalendarIds.has(calendar.id)).length;
    const selectedSummary = selectedCount === 0
        ? "No calendars selected"
        : `Showing ${selectedCount} of ${uiState.calendars.length} calendars`;
    const filteredSummary = uiState.filteredOut > 0
        ? `Filtered out ${uiState.filteredOut} of ${uiState.totalEvents}`
        : "";
    const yearOptions = Array.from({ length: 41 }, (_, index) => uiState.currentYear - 20 + index);
    const selectedSummaryTitle = filteredSummary ? `${selectedSummary} ${filteredSummary}` : selectedSummary;
    const selectedSummaryHeaderContent = <><span>{selectedSummary}</span>{filteredSummary && <span> · {filteredSummary}</span>}</>;
    const selectedSummarySidebarContent = <><span>{selectedSummary}</span>{filteredSummary && <span className="selected-summary-filtered">{filteredSummary}</span>}</>;
    const nextThemeMode = getNextThemeMode(uiState.themeMode);

    return (
        <SidebarProvider className="av-shell" open={uiState.panelExpanded} onOpenChange={(open) => void controller?.setPanelExpanded(open)}>
            <div ref={appRef} className="av-app">
                <header ref={toolbarRef} className="av-toolbar">
                    <div className="controls">
                        <div data-ui-slot="header-leading">
                            <img className="av-header-logo" src={yearViewLogo} alt="Year View" />
                        </div>
                        <div className="view-settings">
                            <Popover open={viewSettingsOpen} onOpenChange={handleViewSettingsChange}>
                                <PopoverTrigger render={<Button id="viewSettingsToggle" variant="ghost" size="icon" aria-label="View settings" title="View settings"><Settings aria-hidden="true" /></Button>} />
                                <PopoverContent container={appRef.current} id="viewSettingsMenu" className="view-settings-menu" role="region" aria-label="View settings">
                                    <div className="view-mode-label" data-tour="view-mode"><span>View:</span><Select value={uiState.viewMode} onValueChange={(value) => { if (value) void controller?.setViewMode(value); }}><SelectTrigger id="viewMode" className="view-mode-select" aria-label="View"><SelectValue>{VIEW_MODE_LABELS[uiState.viewMode]}</SelectValue></SelectTrigger><SelectContent container={appRef.current} className="view-mode-options" alignItemWithTrigger={false} scrollable={false}><SelectItem className="view-mode-option" value="linear">linear</SelectItem><SelectItem className="view-mode-option" value="day-aligned">day-aligned</SelectItem><SelectItem className="view-mode-option" value="week-rows">four-week-row</SelectItem><SelectItem className="view-mode-option" value="two-week-rows">two-week-row</SelectItem><SelectItem className="view-mode-option" value="one-week-rows">one-week-row</SelectItem></SelectContent></Select></div>
                                    <div className="display-options" data-tour="display-options">
                                        <div className="cal-chip-toggle" onClick={toggleSwitchFromRowWhitespace}><Switch id="showWeekNumbers" checked={uiState.showWeekNumbersEnabled} onCheckedChange={(checked) => void controller?.setDisplayOption("showWeekNumbers", checked)} /><Label htmlFor="showWeekNumbers">Show week numbers</Label></div>
                                        <div className="cal-chip-toggle" onClick={toggleSwitchFromRowWhitespace}><Switch id="grayPastDays" checked={uiState.grayPastDaysEnabled} onCheckedChange={(checked) => void controller?.setDisplayOption("grayPastDays", checked)} /><Label htmlFor="grayPastDays">Gray out past days</Label></div>
                                        <div className="cal-chip-toggle" onClick={toggleSwitchFromRowWhitespace}><Switch id="highlightCurrentDay" checked={uiState.highlightCurrentDayEnabled} onCheckedChange={(checked) => void controller?.setDisplayOption("highlightCurrentDay", checked)} /><Label htmlFor="highlightCurrentDay">Highlight current day</Label></div>
                                    </div>
                                    <Button id="restartTourButton" variant="secondary" onClick={() => { setViewSettingsOpen(false); controller?.restartTour(); }}>Restart tour</Button>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <SidebarTrigger size="icon" aria-label="Toggle calendar options" title="Toggle calendar options" />
                        <div className="year-nav">
                            <Button variant="outline" size="icon" aria-label="Previous year" onClick={() => controller?.stepYear(-1)}><ChevronLeft aria-hidden="true" /></Button>
                            <Popover open={yearPickerOpen} onOpenChange={setYearPickerOpen}>
                                <PopoverTrigger render={<Button id="yearInput" className="year-picker-trigger" variant="outline" aria-label={`Year ${uiState.currentYear}`} aria-haspopup="listbox" aria-expanded={yearPickerOpen}>{uiState.currentYear}</Button>} />
                                <PopoverContent container={appRef.current} className="year-picker" role="dialog" aria-label="Choose year">
                                    <div className="year-picker-options" role="listbox" aria-label="Years">
                                        {yearOptions.map((year) => <Button key={year} className="year-picker-option" variant={year === uiState.currentYear ? "secondary" : "ghost"} role="option" aria-selected={year === uiState.currentYear} data-year={year} onClick={() => { controller?.jumpToYear(year); setYearPickerOpen(false); }}>{year}</Button>)}
                                    </div>
                                </PopoverContent>
                            </Popover>
                            <Button variant="outline" size="icon" aria-label="Next year" onClick={() => controller?.stepYear(1)}><ChevronRight aria-hidden="true" /></Button>
                            <Button id="todayButton" variant="secondary" title="Jump to the current day" aria-label="Today" onClick={() => controller?.showToday()}><CalendarClock aria-hidden="true" /><span className="today-button-label">Today</span></Button>
                        </div>
                        <Toggle id="durationFilterToggle" variant="secondary" pressed={uiState.durationFilteringEnabled} onPressedChange={() => controller?.toggleDurationFiltering()} data-tour="duration-filter" title={uiState.durationFilteringEnabled ? "Disable duration and all-day filtering" : "Enable duration and all-day filtering"} aria-label="Filter"><Funnel className="group-aria-pressed/toggle:fill-foreground" aria-hidden="true" /><span className="duration-filter-label">Filter</span></Toggle>
                        <div id="selectedSummary" className="selected-summary selected-summary-header" aria-live="polite" title={selectedSummaryTitle}>{selectedSummaryHeaderContent}</div>
                        <Button id="refreshButton" variant="ghost" size="icon" aria-label="Refresh calendar data" title="Refresh calendar data" onClick={() => void controller?.refreshCalendars()}><RefreshCw aria-hidden="true" /></Button>
                        <Button id="themeToggle" variant="ghost" size="icon" aria-label={`Switch theme to ${nextThemeMode}`} title={`Switch theme to ${nextThemeMode}`} onClick={() => controller?.toggleTheme()}><ThemeActionIcon themeMode={uiState.themeMode} /></Button>
                        <Sheet open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
                            <SheetTrigger render={<Button className="mobile-actions-trigger" variant="ghost" size="icon" aria-label="Open calendar actions" title="Open calendar actions"><Menu aria-hidden="true" /></Button>} />
                            <SheetContent className="mobile-actions-sheet">
                                <SheetHeader>
                                    <SheetTitle>Calendar actions</SheetTitle>
                                </SheetHeader>
                                <div className="mobile-actions-list">
                                    <Button variant="outline" onClick={() => { setMobileActionsOpen(false); setViewSettingsOpen(true); }}><Settings aria-hidden="true" />View settings</Button>
                                    <Button variant="outline" onClick={() => void controller?.refreshCalendars()}><RefreshCw aria-hidden="true" />Refresh calendar data</Button>
                                    <Button variant="outline" onClick={() => controller?.toggleTheme()}><ThemeActionIcon themeMode={uiState.themeMode} />Switch theme to {nextThemeMode}</Button>
                                </div>
                            </SheetContent>
                        </Sheet>
                        <div data-ui-slot="header-actions" hidden />
                    </div>
                </header>
                <div id="yearLayout" className="year-layout">
                    <Sidebar id="calendarFilters" className="calendar-filters" aria-label="Calendar filters" collapsible="offcanvas">
                        <SidebarHeader>
                            <div className="selected-summary selected-summary-sidebar" aria-live="polite" title={selectedSummaryTitle}>{selectedSummarySidebarContent}</div>
                            <div className="cal-actions">
                                {(!uiState.durationFilteringEnabled) && <div id="durationFiltersNotice" className="duration-filters-notice">Duration filter is off. All-day and duration options below are inactive.</div>}
                                <div className={`cal-chip-toggle${!uiState.durationFilteringEnabled ? " filter-overridden" : ""}`} data-tour="global-all-day" onClick={toggleSwitchFromRowWhitespace}><Label htmlFor="allDayOnly">Show all-day only</Label><Switch id="allDayOnly" checked={uiState.allDayOnlyEnabled} disabled={!uiState.durationFilteringEnabled} onCheckedChange={(checked) => void controller?.setAllDayOnly(checked)} /></div>
                                <div className={`cal-chip${!uiState.durationFilteringEnabled ? " filter-overridden" : ""}`} aria-label="Minimum event length in hours" data-tour="global-duration"><Label htmlFor="minDurationHours">Min event length</Label><span className="min-duration-controls"><Button variant="outline" size="icon-sm" id="minDurationDown" disabled={!uiState.durationFilteringEnabled} aria-label="Decrease minimum length by one hour" onClick={() => void controller?.adjustMinDuration(-1)}>-</Button><Input id="minDurationHours" className="duration-hours-input" type="number" min="0" max="9999" step="0.25" value={uiState.globalMinDurationHours} disabled={!uiState.durationFilteringEnabled} title="Minimum event length in hours." onChange={(event) => void controller?.setGlobalMinDuration(event.target.value)} onBlur={(event) => void controller?.setGlobalMinDuration(event.target.value)} /><span className="duration-unit" aria-hidden="true">h</span><Button variant="outline" size="icon-sm" id="minDurationUp" disabled={!uiState.durationFilteringEnabled} aria-label="Increase minimum length by one hour" onClick={() => void controller?.adjustMinDuration(1)}>+</Button></span></div>
                            </div>
                        </SidebarHeader>
                        <SidebarContent>
                            <SidebarGroup>
                                <div className="calendar-list-toolbar">
                                    <SidebarGroupLabel>Calendars</SidebarGroupLabel>
                                    <div className="select-buttons"><Button variant="outline" size="sm" id="selectAllCals" onClick={() => controller?.setAllCalendars(true)}>Select all</Button><Button variant="outline" size="sm" id="deselectAllCals" onClick={() => controller?.setAllCalendars(false)}>None</Button></div>
                                </div>
                                <div className="cal-list" id="calendarList" aria-label="Calendars" data-tour="calendar-list"><CalendarList calendars={uiState.calendars} selectedIds={uiState.selectedCalendarIds} allDayModes={uiState.calendarAllDayModes} minDurationHours={uiState.calendarMinDurationHours} expandedIds={uiState.expandedCalendarIds} disabled={!uiState.durationFilteringEnabled} getGlobalMinDurationHours={() => uiState.globalMinDurationHours} onToggleCalendar={(calendar, selected) => controller?.toggleCalendar(calendar, selected)} onToggleExpanded={(calendar) => controller?.toggleCalendarExpanded(calendar)} onAllDayChange={(calendar, enabled) => controller?.setCalendarAllDay(calendar, enabled)} onDurationChange={(calendar, value) => void controller?.setCalendarDuration(calendar, value)} onDurationStep={(calendar, delta) => void controller?.stepCalendarDuration(calendar, delta)} onReset={(calendar) => controller?.resetCalendarFilters(calendar)} onRemove={(calendar) => void controller?.removeCalendar(calendar)} /></div>
                            </SidebarGroup>
                            <div data-ui-slot="sidebar-sections" />
                        </SidebarContent>
                        <SidebarFooter><div data-ui-slot="sidebar-footer" /></SidebarFooter>
                    </Sidebar>
                    <SidebarInset className="main-panel"><Card className="calendar-card">
                        <div data-ui-slot="content-empty-state" className="content-empty-state" hidden />
                        <div className="calendar-wrap"><ScrollArea className="calendar-scroll-area" viewportProps={{ id: "gridViewport", ref: gridViewportRef, className: "grid-viewport", "aria-label": "Scrollable annual calendar" }}><div id="gridHeader" className="grid-header hidden" aria-hidden="true" /><section id="gridRows" className="calendar-rows" aria-label="Calendar months" /></ScrollArea>{embeddedDemo && <p className={`scroll-hint${showScrollHint ? " is-visible" : ""}`} role="status">Scrolling is enabled on the full page demo.</p>}</div>
                    </Card></SidebarInset>
                </div>
            </div>
        </SidebarProvider>
    );
}

export function YearView({ config = {} }: { config?: YearViewConfig }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState("");
    const [uiState, setUiState] = useState<UiState>(EMPTY_UI_STATE);
    const [controller, setController] = useState<AppController | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const themeRoot = root.ownerDocument?.documentElement ?? document.documentElement;
        if (!themeRoot) return;
        let disposed = false;
        let api: { destroy?: () => void } | null = null;
        const lifecycle = new AbortController();
        void initApp({ ...config, root, themeRoot, signal: lifecycle.signal, onUiStateChange: setUiState }).then((nextApi) => {
            if (disposed) nextApi.destroy?.();
            else {
                api = nextApi;
                setController(nextApi as unknown as AppController);
            }
        }).catch((reason: unknown) => {
            if (!disposed) setError(reason instanceof Error ? reason.message : "Year View could not start.");
        });
        return () => {
            disposed = true;
            lifecycle.abort();
            api?.destroy?.();
        };
    }, [config]);

    return <div ref={rootRef} className="av-root">{error && <p className="app-error" role="alert">{error}</p>}<YearViewShell embeddedDemo={config.embeddedDemo === true} uiState={uiState} controller={controller} /><OnboardingTour rootRef={rootRef} hasCalendars={uiState.calendars.length > 0} /></div>;
}

export function mountYearView(element: Element, config: YearViewConfig = {}) {
    const root = createRoot(element);
    root.render(<YearView config={config} />);
    return () => root.unmount();
}
