import { fetchCalendars, fetchCalendarEvents } from "./calendar-service.js";
import {
    loadPersistedSelection,
    persistSelection,
    loadPanelState,
    persistPanelState,
    loadThemePreference,
    persistTheme,
    loadWeekNumbersPreference,
    persistWeekNumbersPreference
} from "./storage.js";
import { applyTheme, detectSystemMode } from "./theme.js";

const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];

const yearInput = document.getElementById("yearInput");
const grid = document.getElementById("calendarGrid");
const eventsLayer = document.getElementById("eventsLayer");
const calendarList = document.getElementById("calendarList");
const calendarFilters = document.getElementById("calendarFilters");
const yearLayout = document.getElementById("yearLayout");
const allDayOnlyInput = document.getElementById("allDayOnly");
const showWeekNumbersInput = document.getElementById("showWeekNumbers");
const minDurationInput = document.getElementById("minDurationHours");
const minDurationDownBtn = document.getElementById("minDurationDown");
const minDurationUpBtn = document.getElementById("minDurationUp");
const selectAllBtn = document.getElementById("selectAllCals");
const deselectAllBtn = document.getElementById("deselectAllCals");
const toggleCalendarsBtn = document.getElementById("toggleCalendars");
const selectedSummary = document.getElementById("selectedSummary");
const themeToggleBtn = document.getElementById("themeToggle");
const yearButtons = document.querySelectorAll("[data-year-step]");
const YEAR_MIN = Number(yearInput.min) || 1900;
const YEAR_MAX = Number(yearInput.max) || 2999;
let availableCalendars = [];
let selectedCalendarIds = new Set();
let currentYear = new Date().getFullYear();
let lastFilterStats = { filteredOut: 0, total: 0, thresholdHours: 0, active: false };
let themeMode = "auto";
let systemThemeWatcher = null;

const onClick = (el, handler) => el?.addEventListener("click", handler);
const onChange = (el, handler) => el?.addEventListener("change", handler);

async function loadEvents(year) {
    if (!selectedCalendarIds.size) {
        lastFilterStats = { filteredOut: 0, total: 0, thresholdHours: 0, active: false };
        return [];
    }

    const options = {
        calendarIds: Array.from(selectedCalendarIds),
        allDayOnly: allDayOnlyInput?.checked || false
    };

    try {
        const events = await fetchCalendarEvents(year, options);
        const normalized = normalizeEvents(events || []);
        const minDurationMs = getMinDurationMs();
        const minDurationHours = minDurationMs / (60 * 60 * 1000);
        const filtered = minDurationMs > 0 ? normalized.filter((ev) => eventDurationMs(ev) >= minDurationMs) : normalized;
        lastFilterStats = {
            filteredOut: Math.max(0, normalized.length - filtered.length),
            total: normalized.length,
            thresholdHours: minDurationHours,
            active: minDurationMs > 0 && normalized.length > 0
        };
        return filtered;
    } catch (err) {
        console.error("[loadEvents] failed", err);
        lastFilterStats = { filteredOut: 0, total: 0, thresholdHours: 0, active: false };
        return [];
    }
}

function daysInMonth(monthIndex, year) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function renderCalendar(year) {
    grid.innerHTML = "";
    months.forEach((name, monthIndex) => {
        const monthCell = document.createElement("div");
        monthCell.className = "cell month";
        monthCell.textContent = name;
        grid.appendChild(monthCell);

        const maxDays = daysInMonth(monthIndex, year);
        for (let day = 1; day <= 31; day += 1) {
            const cell = document.createElement("div");
            if (day > maxDays) {
                cell.className = "cell disabled";
            } else {
                const weekday = new Date(year, monthIndex, day).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                cell.className = isWeekend ? "cell weekend" : "cell";
                const label = document.createElement("span");
                label.className = "day-number";
                label.textContent = day;
                cell.appendChild(label);
                if (showWeekNumbersInput?.checked) {
                    const date = new Date(Date.UTC(year, monthIndex, day));
                    if (date.getUTCDay() === 1) {
                        const weekLabel = document.createElement("span");
                        weekLabel.className = "week-number";
                        weekLabel.textContent = `W${getISOWeekNumber(date)}`;
                        cell.appendChild(weekLabel);
                    }
                }
            }

            grid.appendChild(cell);
        }
    });
}

function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function splitEventByMonth(year, event) {
    if (!event.start || !event.end) return [];

    const allDay = isAllDayEvent(event);
    const adjustedEnd = allDay ? adjustAllDayEnd(event.end) : event.end;

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const start = new Date(Math.max(event.start.getTime(), yearStart.getTime()));
    const end = new Date(Math.min(adjustedEnd.getTime(), yearEnd.getTime()));
    if (end < start) return [];

    const startLocal = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endLocal = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    const segments = [];
    let cursorMonth = startLocal.getMonth();
    const endMonth = endLocal.getMonth();

    while (cursorMonth <= endMonth) {
        const monthStartDay = cursorMonth === startLocal.getMonth() ? startLocal.getDate() : 1;
        let monthEndDay = cursorMonth === endMonth ? endLocal.getDate() : daysInMonth(cursorMonth, year);

        if (!allDay && start.toDateString() === end.toDateString()) {
            monthEndDay = monthStartDay;
        }
        segments.push({
            monthIndex: cursorMonth,
            startDay: monthStartDay,
            endDay: monthEndDay,
            title: event.title
        });
        cursorMonth += 1;
    }

    return segments;
}

function isAllDayEvent(event) {
    if (event.isAllDay === true || event.allDay === true) return true;
    if (!event.start || !event.end) return false;
    const start = event.start;
    const end = event.end;
    const startMidnight = start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0;
    const endMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;
    const fullDays = (end.getTime() - start.getTime()) % (24 * 60 * 60 * 1000) === 0;
    return startMidnight && endMidnight && fullDays;
}

function adjustAllDayEnd(end) {
    const dt = new Date(end.getTime());
    if (dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0) {
        dt.setDate(dt.getDate() - 1);
    }
    return dt;
}

function eventDurationMs(ev) {
    if (!ev || !ev.start || !ev.end) return 0;
    if (isAllDayEvent(ev)) {
        const inclusiveEnd = adjustAllDayEnd(ev.end);
        return inclusiveEnd.getTime() + 24 * 60 * 60 * 1000 - ev.start.getTime();
    }
    return ev.end.getTime() - ev.start.getTime();
}

function getMinDurationMs() {
    const val = Number(minDurationInput?.value);
    if (Number.isNaN(val) || val < 0) return 0;
    return val * 60 * 60 * 1000;
}

function adjustMinDuration(deltaHours) {
    if (!minDurationInput) return;
    const current = Number(minDurationInput.value);
    const safeCurrent = Number.isNaN(current) ? 0 : current;
    const next = Math.max(0, safeCurrent + deltaHours);
    minDurationInput.value = String(Math.round(next * 100) / 100);
    setYear(currentYear);
}

function formatFilterSummary() {
    if (!lastFilterStats || !lastFilterStats.active) return "";
    const { filteredOut, total, thresholdHours } = lastFilterStats;
    if (!total) return "";
    const hours = Number.isFinite(thresholdHours) ? thresholdHours : 0;
    const displayHours = hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(2).replace(/\.0+$/, "").replace(/0+$/, "");
    if (filteredOut > 0) {
        return `Filtered out ${filteredOut} of ${total} events under ${displayHours}h`;
    }
    return `No events under ${displayHours}h`;
}

function renderEvents(year, events) {
    eventsLayer.querySelectorAll(".event").forEach((el) => el.remove());
    const monthLaneEnds = Array.from({ length: 12 }, () => []);

    const sortedEvents = [...events].sort((a, b) => {
        const startDiff = a.start?.getTime?.() - b.start?.getTime?.();
        if (Number.isFinite(startDiff) && startDiff !== 0) return startDiff;
        const lenA = eventDurationMs(a);
        const lenB = eventDurationMs(b);
        if (lenA !== lenB) return lenB - lenA; // longer first
        return (a.title || "").localeCompare(b.title || "");
    });

    sortedEvents.forEach((event) => {
        const segments = splitEventByMonth(year, event);
        if (!segments.length) return;

        const eventStartMonth = event.start?.getMonth?.();
        const eventEndMonth = (isAllDayEvent(event) ? adjustAllDayEnd(event.end) : event.end)?.getMonth?.();

        const laneIndex = findLaneForSegments(monthLaneEnds, segments);
        segments.forEach((seg) => {
            // update occupancy for this lane in each month the event spans
            const lanes = monthLaneEnds[seg.monthIndex];
            lanes[laneIndex] = Math.max(lanes[laneIndex] ?? -Infinity, seg.endDay);

            const continuesPrev = Number.isInteger(eventStartMonth) ? seg.monthIndex > eventStartMonth : false;
            const continuesNext = Number.isInteger(eventEndMonth) ? seg.monthIndex < eventEndMonth : false;

            const bar = document.createElement("div");
            bar.className = "event";
            if (continuesPrev) bar.classList.add("continues-prev");
            if (continuesNext) bar.classList.add("continues-next");
            const color = getEventColor(event);
            applyEventColor(bar, color);
            bar.style.setProperty("--lane", laneIndex);
            bar.style.gridRow = `${seg.monthIndex + 1} / ${seg.monthIndex + 2}`;
            bar.style.gridColumn = `${seg.startDay + 1} / ${seg.endDay + 2}`;
            bar.textContent = event.title;
            const startStr = event.start?.toLocaleString?.() || "";
            const endStr = event.end?.toLocaleString?.() || "";
            const lines = [];
            if (event.title) lines.push(event.title);
            if (event.calendarName) lines.push(`Calendar: ${event.calendarName}`);
            lines.push(`${startStr} – ${endStr}`);
            if (event.location) lines.push(`Location: ${event.location}`);
            if (event.description) lines.push(event.description);
            bar.title = lines.filter(Boolean).join("\n");
            eventsLayer.appendChild(bar);
        });
    });

    applyDynamicRowHeights(monthLaneEnds);
}

function findLaneForSegments(monthLaneEnds, segments) {
    let laneIndex = 0;
    while (true) {
        let fitsAll = true;
        for (let i = 0; i < segments.length; i += 1) {
            const { monthIndex, startDay } = segments[i];
            const endForLane = monthLaneEnds[monthIndex][laneIndex] ?? -Infinity;
            if (endForLane >= startDay) {
                fitsAll = false;
                break;
            }
        }
        if (fitsAll) return laneIndex;
        laneIndex += 1;
    }
}

function getEventColor(event) {
    return event.calendarColor || event.color || "#38bdf8";
}

function applyEventColor(el, color) {
    const bg = alphaFromHex(color, 0.25) || color;
    const border = alphaFromHex(color, 0.6) || color;
    el.style.background = `linear-gradient(135deg, ${bg}, ${bg})`;
    el.style.borderColor = border;
}

function alphaFromHex(color, alpha) {
    if (typeof color !== "string") return null;
    const m = color.match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const hex = m[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseCalendarDate(value, isAllDay) {
    if (value instanceof Date) return value;
    if (typeof value !== "string") return null;
    const s = value.trim();

    if (/^\d{8}$/.test(s)) {
        const y = Number(s.slice(0, 4));
        const m = Number(s.slice(4, 6)) - 1;
        const d = Number(s.slice(6, 8));
        return new Date(y, m, d, isAllDay ? 0 : 0, 0, 0);
    }

    if (/^\d{8}T\d{6}$/.test(s)) {
        const y = Number(s.slice(0, 4));
        const m = Number(s.slice(4, 6)) - 1;
        const d = Number(s.slice(6, 8));
        const hh = Number(s.slice(9, 11));
        const mm = Number(s.slice(11, 13));
        const ss = Number(s.slice(13, 15));
        return new Date(y, m, d, hh, mm, ss);
    }

    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeEvents(events) {
    return events
        .map((ev) => {
            const allDay = ev.allDay === true || ev.isAllDay === true;
            const start = parseCalendarDate(ev.start || ev.startDate, allDay);
            const end = parseCalendarDate(ev.end || ev.endDate, allDay);
            if (!start || !end) return null;
            return { ...ev, start, end, isAllDay: allDay };
        })
        .filter(Boolean);
}

function clampYear(value) {
    return Math.min(YEAR_MAX, Math.max(YEAR_MIN, value));
}

async function setYear(newYear) {
    const year = clampYear(newYear);
    currentYear = year;
    yearInput.value = year;
    renderCalendar(year);
    const events = await loadEvents(year);
    renderEvents(year, events);
    updateSelectedSummary();
}

async function renderCalendarList(calendars) {
    calendarList.innerHTML = "";
    calendars.forEach((cal) => {
        const chip = document.createElement("button");
        chip.type = "button";
        const isSelected = selectedCalendarIds.has(cal.id);
        chip.className = isSelected ? "cal-chip selected" : "cal-chip";
        chip.textContent = cal.name || "(unnamed)";
        chip.dataset.id = cal.id;
        chip.addEventListener("click", () => {
            const selected = selectedCalendarIds.has(cal.id);
            if (selected) {
                selectedCalendarIds.delete(cal.id);
                chip.classList.remove("selected");
            } else {
                selectedCalendarIds.add(cal.id);
                chip.classList.add("selected");
            }
            chip.setAttribute("aria-pressed", String(selectedCalendarIds.has(cal.id)));
            updateSelectedSummary();
            persistSelection(selectedCalendarIds);
            setYear(currentYear);
        });
        chip.setAttribute("aria-pressed", String(isSelected));
        calendarList.appendChild(chip);
    });
    updateSelectedSummary();
}

function setAllCalendars(selected) {
    if (!availableCalendars.length) return;
    if (selected) {
        selectedCalendarIds = new Set(availableCalendars.map((c) => c.id));
    } else {
        selectedCalendarIds = new Set();
    }
    renderCalendarList(availableCalendars);
    persistSelection(selectedCalendarIds);
    setYear(currentYear);
}

function applyDynamicRowHeights(monthLanes) {
    const baseHeight = 72;
    const laneSpacing = 26;
    const firstLaneOffset = 55;

    const rowHeights = monthLanes.map((lanes) => {
        const laneCount = lanes.length;
        if (laneCount === 0) return `${baseHeight}px`;
        const needed = firstLaneOffset + Math.max(0, laneCount - 1) * laneSpacing;
        return `${Math.max(baseHeight, needed)}px`;
    });

    grid.style.gridTemplateRows = rowHeights.join(" ");
    eventsLayer.style.gridTemplateRows = rowHeights.join(" ");
}

function updateSelectedSummary() {
    if (!selectedSummary) return;
    const selected = availableCalendars.filter((c) => selectedCalendarIds.has(c.id));
    const total = availableCalendars.length;
    const selectedCount = selected.length;
    const collapsed = calendarFilters?.classList.contains("collapsed");
    const filterText = formatFilterSummary();

    if (collapsed) {
        const base = `Showing ${selectedCount} of ${total} calendars`;
        selectedSummary.textContent = filterText ? `${base} · ${filterText}` : base;
        selectedSummary.title = selectedCount ? selected.map((c) => c.name || "(unnamed)").join(", ") : "No calendars selected";
        return;
    }

    if (!selectedCount) {
        selectedSummary.textContent = "No calendars selected";
        selectedSummary.title = "";
        return;
    }
    const base = `Showing ${selectedCount} of ${total} calendars`;
    selectedSummary.textContent = filterText ? `${base} · ${filterText}` : base;
    selectedSummary.title = selected.map((c) => c.name || "(unnamed)").join(", ");
}

function setCalendarPanelVisible(expanded) {
    if (!calendarFilters || !toggleCalendarsBtn) return;
    calendarFilters.classList.toggle("collapsed", !expanded);
    if (yearLayout) {
        yearLayout.classList.toggle("sidebar-collapsed", !expanded);
    }
    toggleCalendarsBtn.setAttribute("aria-expanded", String(expanded));
    toggleCalendarsBtn.textContent = expanded ? "Hide options" : "Show options";
    persistPanelState(expanded);
    updateSelectedSummary();
}

async function loadCalendars() {
    availableCalendars = await fetchCalendars();
    const { ids: persistedIds, found } = await loadPersistedSelection();
    const filtered = availableCalendars.filter((c) => persistedIds.has(c.id));
    if (found) {
        selectedCalendarIds = new Set(filtered.map((c) => c.id));
    } else {
        selectedCalendarIds = new Set(availableCalendars.map((c) => c.id));
    }
    await renderCalendarList(availableCalendars);
    updateSelectedSummary();
    await persistSelection(selectedCalendarIds);
}

async function initTheme() {
    const preferred = await loadThemePreference();
    setThemeMode(preferred || "auto");
}

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
    updateThemeToggleLabel();
}

function updateThemeToggleLabel() {
    if (!themeToggleBtn) return;
    const resolved = themeMode === "auto" ? detectSystemMode() : themeMode;
    const label = themeMode === "auto" ? `Theme: Auto (${resolved})` : `Theme: ${resolved}`;
    const next = themeMode === "auto" ? "Light" : themeMode === "light" ? "Dark" : "Auto";
    themeToggleBtn.textContent = `${label} → ${next}`;
}

async function init() {
    await initTheme();
    if (showWeekNumbersInput) {
        showWeekNumbersInput.checked = await loadWeekNumbersPreference();
    }
    await loadCalendars();
    await setYear(currentYear);
    updateSelectedSummary();

    onChange(yearInput, () => {
        const nextYear = Number(yearInput.value) || currentYear;
        setYear(nextYear);
    });

    yearButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const step = Number(btn.dataset.yearStep) || 0;
            const nextYear = Number(yearInput.value) + step;
            setYear(nextYear);
        });
    });

    onChange(allDayOnlyInput, () => setYear(currentYear));
    onChange(showWeekNumbersInput, () => {
        persistWeekNumbersPreference(showWeekNumbersInput.checked);
        setYear(currentYear);
    });
    onChange(minDurationInput, () => setYear(currentYear));
    onClick(minDurationDownBtn, () => adjustMinDuration(-1));
    onClick(minDurationUpBtn, () => adjustMinDuration(1));
    onClick(selectAllBtn, () => setAllCalendars(true));
    onClick(deselectAllBtn, () => setAllCalendars(false));
    if (toggleCalendarsBtn) {
        onClick(toggleCalendarsBtn, () => {
            const isExpanded = toggleCalendarsBtn.getAttribute("aria-expanded") === "true";
            setCalendarPanelVisible(!isExpanded);
        });
        const initialExpanded = await loadPanelState();
        setCalendarPanelVisible(initialExpanded);
    }

    onClick(themeToggleBtn, () => {
        const modes = ["auto", "light", "dark"];
        const idx = modes.indexOf(themeMode);
        const next = modes[(idx + 1) % modes.length];
        setThemeMode(next);
    });
}

document.addEventListener("DOMContentLoaded", init);
