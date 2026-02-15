import { fetchCalendars, fetchCalendarEvents } from "./calendar-service.js";
import {
    loadPersistedSelection,
    persistSelection,
    loadPanelState,
    persistPanelState,
    loadThemePreference,
    persistTheme,
    loadWeekNumbersPreference,
    persistWeekNumbersPreference,
    loadRefreshSettings,
    persistRefreshSettings,
    loadGrayPastDays,
    persistGrayPastDays,
    loadHighlightCurrentDay,
    persistHighlightCurrentDay,
    loadViewMode,
    persistViewMode
} from "./storage.js";
import { applyTheme, detectSystemMode } from "./theme.js";

// Enable dummy data only when explicitly requested by the runtime (e.g. screenshot pipeline).
if (typeof globalThis.ENABLE_DUMMY_CALENDARS !== "boolean") {
    globalThis.ENABLE_DUMMY_CALENDARS = false;
}

// Constants
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GRID_HEADER_OFFSET = 2; // Accounts for month label column + header row
const MAX_LANES = 50; // Safety limit to prevent infinite loops in lane finding

// Grid configuration constants
const LINEAR_VIEW_COLS = 31; // Standard linear view always shows 31 days
const DAYS_PER_WEEK_ROW = 28; // Continuous weeks: 4 weeks × 7 days

// Dynamic grid calculation - calculates exact columns needed for day-aligned view per year
function getMaxColsDayAligned(year) {
    // Calculate max columns needed dynamically based on actual month data
    // Finds the month requiring most columns (starts latest in week + has most days)
    let maxCols = 0;
    for (let month = 0; month < 12; month++) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const dayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
        const colsNeeded = dayOfWeek + daysInMonth;
        maxCols = Math.max(maxCols, colsNeeded);
    }
    return maxCols;
}

// Row height configuration (used for dynamic row expansion based on event lanes)
const ROW_HEIGHT_CONFIG = {
    baseHeight: 72,       // Minimum row height in pixels
    laneSpacing: 26,      // Vertical spacing between event lanes
    firstLaneOffset: 55,  // Space needed for first event lane
    headerHeight: "auto"  // Header row uses auto height
};

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
const refreshButton = document.getElementById("refreshButton");
const grayPastDaysInput = document.getElementById("grayPastDays");
const highlightCurrentDayInput = document.getElementById("highlightCurrentDay");
const viewModeSelect = document.getElementById("viewMode");
const yearButtons = document.querySelectorAll("[data-year-step]");
const YEAR_MIN = Number(yearInput.min) || 1900;
const YEAR_MAX = Number(yearInput.max) || 2999;
let availableCalendars = [];
let selectedCalendarIds = new Set();
let currentYear = new Date().getFullYear();
let lastFilterStats = { filteredOut: 0, total: 0, thresholdHours: 0, active: false };
let themeMode = "auto";
let systemThemeWatcher = null;
let autoRefreshTimer = null;
let refreshSettings = { autoRefreshEnabled: true, autoRefreshInterval: 300000 };
let isRefreshing = false;
let grayPastDaysEnabled = false;
let highlightCurrentDayEnabled = false;
let viewMode = "linear";

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

// ============================================================================
// Helper Functions for Event Rendering (shared across all view modes)
// ============================================================================

/**
 * Returns the year boundaries for clamping event dates
 */
function getYearBoundaries(year) {
    return {
        start: new Date(year, 0, 1),
        end: new Date(year, 11, 31, 23, 59, 59, 999)
    };
}

/**
 * Sorts events by start time, then by duration (longest first), then by title
 */
function sortEventsByStartAndDuration(events) {
    return [...events].sort((a, b) => {
        const startDiff = a.start?.getTime?.() - b.start?.getTime?.();
        if (Number.isFinite(startDiff) && startDiff !== 0) return startDiff;
        const lenA = eventDurationMs(a);
        const lenB = eventDurationMs(b);
        if (lenA !== lenB) return lenB - lenA;
        return (a.title || "").localeCompare(b.title || "");
    });
}

/**
 * Creates a tooltip string for an event
 */
function createEventTooltip(event, startStr, endStr) {
    const lines = [];
    if (event.title) lines.push(event.title);
    if (event.calendarName) lines.push(`Calendar: ${event.calendarName}`);
    lines.push(`${startStr} – ${endStr}`);
    if (event.location) lines.push(`Location: ${event.location}`);
    if (event.description) lines.push(event.description);
    return lines.filter(Boolean).join("\n");
}

/**
 * Creates an event bar DOM element with common styling
 */
function createEventBar(event, laneIndex, gridRow, gridColumn, continuesPrev, continuesNext) {
    const bar = document.createElement("div");
    bar.className = "event";
    if (continuesPrev) bar.classList.add("continues-prev");
    if (continuesNext) bar.classList.add("continues-next");
    
    const color = getEventColor(event);
    applyEventColor(bar, color);
    bar.style.setProperty("--lane", laneIndex);
    bar.style.gridRow = gridRow;
    bar.style.gridColumn = gridColumn;
    bar.textContent = event.title;
    
    return bar;
}

/**
 * Calculates row heights based on the maximum number of event lanes per row
 * @param {number[]} laneCounts - Array where each element is the max lanes needed for that row
 * @param {boolean} includeHeader - Whether to include a header row at the start
 * @returns {string} Space-separated list of row heights for CSS grid-template-rows
 */
function calculateRowHeights(laneCounts, includeHeader = false) {
    const heights = [];
    
    if (includeHeader) {
        heights.push(ROW_HEIGHT_CONFIG.headerHeight);
    }
    
    for (const laneCount of laneCounts) {
        if (laneCount === 0) {
            heights.push(`${ROW_HEIGHT_CONFIG.baseHeight}px`);
        } else {
            const neededHeight = ROW_HEIGHT_CONFIG.firstLaneOffset + 
                                Math.max(0, laneCount - 1) * ROW_HEIGHT_CONFIG.laneSpacing;
            heights.push(`${Math.max(ROW_HEIGHT_CONFIG.baseHeight, neededHeight)}px`);
        }
    }
    
    return heights.join(" ");
}

function daysInMonth(monthIndex, year) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function renderCalendar(year) {
    if (viewMode === "day-aligned") {
        renderDayAlignedCalendar(year);
    } else if (viewMode === "week-rows") {
        renderWeekRowsCalendar(year);
    } else {
        renderLinearCalendar(year);
    }
}

function renderLinearCalendar(year) {
    grid.innerHTML = "";
    grid.className = "calendar";
    eventsLayer.className = "events-layer";

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    const todayDate = new Date(todayYear, todayMonth, todayDay);

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

                // Apply current day highlight
                if (highlightCurrentDayEnabled && year === todayYear && monthIndex === todayMonth && day === todayDay) {
                    cell.classList.add("current-day");
                }

                // Apply past day gray overlay
                if (grayPastDaysEnabled) {
                    const cellDate = new Date(year, monthIndex, day);
                    if (cellDate < todayDate) {
                        cell.classList.add("past-day");
                    }
                }
                if (showWeekNumbersInput?.checked) {
                    const date = new Date(Date.UTC(year, monthIndex, day));
                    if (date.getUTCDay() === 1) {
                        const weekLabel = document.createElement("span");
                        weekLabel.className = "week-number";
                        weekLabel.textContent = `${getISOWeekNumber(date)}`;
                        cell.appendChild(weekLabel);
                    }
                }
            }

            grid.appendChild(cell);
        }
    });
}

function renderDayAlignedCalendar(year) {
    grid.innerHTML = "";
    grid.className = "calendar day-aligned";
    eventsLayer.className = "events-layer day-aligned";

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    const todayDate = new Date(todayYear, todayMonth, todayDay);

    const weekdayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    // Add empty cell for month column header
    const emptyHeader = document.createElement("div");
    emptyHeader.className = "cell month";
    grid.appendChild(emptyHeader);

    // Add weekday headers - repeating pattern for 37 columns (max: 6 empty + 31 days)
    for (let i = 0; i < 37; i++) {
        const header = document.createElement("div");
        header.className = "weekday-header";
        header.textContent = weekdayNames[i % 7];
        grid.appendChild(header);
    }

    months.forEach((name, monthIndex) => {
        const monthCell = document.createElement("div");
        monthCell.className = "cell month";
        monthCell.textContent = name;
        grid.appendChild(monthCell);

        const maxDays = daysInMonth(monthIndex, year);
        const firstDayOfMonth = new Date(year, monthIndex, 1).getDay();

        // Add empty cells before the first day to align with weekday
        for (let i = 0; i < firstDayOfMonth; i++) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "cell disabled";
            grid.appendChild(emptyCell);
        }

        // Add actual days
        for (let day = 1; day <= maxDays; day++) {
            const date = new Date(year, monthIndex, day);
            const weekday = date.getDay();
            const isWeekend = weekday === 0 || weekday === 6;
            const cell = document.createElement("div");
            cell.className = isWeekend ? "cell weekend" : "cell";
            cell.dataset.monthIndex = monthIndex;
            cell.dataset.day = day;

            const label = document.createElement("span");
            label.className = "day-number";
            label.textContent = day;
            cell.appendChild(label);

            // Apply current day highlight
            if (highlightCurrentDayEnabled && year === todayYear && monthIndex === todayMonth && day === todayDay) {
                cell.classList.add("current-day");
            }

            // Apply past day gray overlay
            if (grayPastDaysEnabled) {
                const cellDate = new Date(year, monthIndex, day);
                if (cellDate < todayDate) {
                    cell.classList.add("past-day");
                }
            }

            if (showWeekNumbersInput?.checked && weekday === 1) {
                const weekLabel = document.createElement("span");
                weekLabel.className = "week-number";
                weekLabel.textContent = `${getISOWeekNumber(new Date(Date.UTC(year, monthIndex, day)))}`;
                cell.appendChild(weekLabel);
            }

            grid.appendChild(cell);
        }

        // Add empty cells after the last day to fill the rest of the row (up to 37 total)
        const totalCells = firstDayOfMonth + maxDays;
        const cellsToAdd = 37 - totalCells;
        for (let i = 0; i < cellsToAdd; i++) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "cell disabled";
            grid.appendChild(emptyCell);
        }
    });
}

function renderWeekRowsCalendar(year) {
    grid.innerHTML = "";
    grid.className = "calendar week-rows";
    eventsLayer.className = "events-layer week-rows";

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();
    const todayDate = new Date(todayYear, todayMonth, todayDay);

    const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    // Add weekday headers - repeat 4 times for 4 weeks (no month column)
    for (let week = 0; week < 4; week++) {
        weekdayNames.forEach(name => {
            const header = document.createElement("div");
            header.className = "weekday-header";
            header.textContent = name;
            grid.appendChild(header);
        });
    }

    // Find the first Monday of the year (or before)
    let currentDate = new Date(year, 0, 1);
    const firstDayOfYear = currentDate.getDay();
    // Adjust to previous Monday: Sunday (0) needs to go back 6 days, other days go back (day - 1)
    const daysToSubtract = firstDayOfYear === 0 ? 6 : firstDayOfYear - 1;
    currentDate.setDate(currentDate.getDate() - daysToSubtract);

    const endDate = new Date(year, 11, 31);
    let rowNumber = 0;

    while (currentDate <= endDate || rowNumber * 28 < 365) {
        rowNumber++;

        const rowStart = new Date(currentDate);

        // Add 28 days (4 weeks, Monday to Sunday)
        for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
            const date = new Date(currentDate);
            date.setDate(date.getDate() + dayOffset);

            const cell = document.createElement("div");
            const monthIndex = date.getMonth();
            const day = date.getDate();
            const dateYear = date.getFullYear();

            // Check if date is within the target year
            if (dateYear !== year) {
                cell.className = "cell disabled";
            } else {
                const weekday = date.getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                cell.className = isWeekend ? "cell weekend" : "cell";
                cell.dataset.monthIndex = monthIndex;
                cell.dataset.day = day;

                const label = document.createElement("span");
                label.className = "day-number";

                // If it's the first day of the month, show month name instead of "1"
                if (day === 1) {
                    label.textContent = months[monthIndex].substring(0, 3);
                    label.classList.add("month-label");
                } else {
                    label.textContent = day;
                }

                cell.appendChild(label);

                // Add week number on Mondays (dayOffset % 7 === 0 means Monday in our grid)
                if (dayOffset % 7 === 0 && showWeekNumbersInput?.checked) {
                    const weekLabel = document.createElement("span");
                    weekLabel.className = "week-number";
                    weekLabel.textContent = `${getISOWeekNumber(new Date(Date.UTC(dateYear, monthIndex, day)))}`;
                    cell.appendChild(weekLabel);
                }

                // Apply current day highlight
                if (highlightCurrentDayEnabled && dateYear === todayYear && monthIndex === todayMonth && day === todayDay) {
                    cell.classList.add("current-day");
                }

                // Apply past day gray overlay
                if (grayPastDaysEnabled && date < todayDate) {
                    cell.classList.add("past-day");
                }
            }

            grid.appendChild(cell);
        }

        // Move to next 4-week period
        currentDate.setDate(currentDate.getDate() + 28);

        // Safety check to prevent infinite loop
        if (rowNumber > 14) break;
    }
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

    if (viewMode === "linear") {
        renderLinearEvents(year, events);
    } else if (viewMode === "day-aligned") {
        renderDayAlignedEvents(year, events);
    } else if (viewMode === "week-rows") {
        renderWeekRowsEvents(year, events);
    }
}

function renderLinearEvents(year, events) {
    const monthLaneEnds = Array.from({ length: 12 }, () => []);

    const sortedEvents = sortEventsByStartAndDuration(events);

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

            const bar = createEventBar(
                event,
                laneIndex,
                `${seg.monthIndex + 1} / ${seg.monthIndex + 2}`,
                `${seg.startDay + 1} / ${seg.endDay + 2}`,
                continuesPrev,
                continuesNext
            );

            const startStr = event.start?.toLocaleString?.() || "";
            const endStr = event.end?.toLocaleString?.() || "";
            bar.title = createEventTooltip(event, startStr, endStr);
            
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
    const laneCounts = monthLanes.map(lanes => lanes.length);
    const rowHeights = calculateRowHeights(laneCounts);
    
    grid.style.gridTemplateRows = rowHeights;
    eventsLayer.style.gridTemplateRows = rowHeights;
}

// Helper function to iterate through days of week, handling week wrapping
// Converts Sunday-based day (0-6) to Monday-based (0=Mon, 6=Sun)
function forEachWeekDay(startDayOfWeek, endDayOfWeek, callback) {
    const startDay = (startDayOfWeek + 6) % 7; // Convert to Monday-based (0=Mon)
    const endDay = (endDayOfWeek + 6) % 7;

    if (startDay <= endDay) {
        // Simple case: no week wrapping
        for (let d = startDay; d <= endDay; d++) {
            callback(d);
        }
    } else {
        // Week wrapping case (e.g., Saturday to Monday)
        for (let d = startDay; d < 7; d++) {
            callback(d);
        }
        for (let d = 0; d <= endDay; d++) {
            callback(d);
        }
    }
}

function renderDayAlignedEvents(year, events) {
    // For day-aligned view, each month is one row with repeating weekday columns
    // Maximum columns dynamically calculated based on the year
    const maxCols = getMaxColsDayAligned(year);
    // Track lanes per month
    const monthLaneEnds = Array.from({ length: 12 }, () => []);

    const sortedEvents = sortEventsByStartAndDuration(events);

    // Build row height data per month
    const monthRowHeights = Array.from({ length: 12 }, () => 0);

    const { start: yearStart, end: yearEnd } = getYearBoundaries(year);

    sortedEvents.forEach((event) => {
        if (!event.start || !event.end) return;

        const allDay = isAllDayEvent(event);
        const adjustedEnd = allDay ? adjustAllDayEnd(event.end) : event.end;

        const start = new Date(Math.max(event.start.getTime(), yearStart.getTime()));
        const end = new Date(Math.min(adjustedEnd.getTime(), yearEnd.getTime()));

        if (end < start) return;

        const startMonth = start.getMonth();
        const startDay = start.getDate();
        const endMonth = end.getMonth();
        const endDay = end.getDate();

        // For each month this event spans
        for (let monthIdx = startMonth; monthIdx <= endMonth; monthIdx++) {
            const firstDayOfMonth = new Date(year, monthIdx, 1).getDay();
            const daysInThisMonth = daysInMonth(monthIdx, year);

            const monthStartDay = monthIdx === startMonth ? startDay : 1;
            const monthEndDay = monthIdx === endMonth ? endDay : daysInThisMonth;

            // Find a lane for this segment within this month
            let laneIndex = 0;
            let foundLane = false;

            while (!foundLane) {
                foundLane = true;
                const lanes = monthLaneEnds[monthIdx];

                // Check if this lane is free for all days of this event in this month
                // Calculate the column position for each day
                for (let day = monthStartDay; day <= monthEndDay; day++) {
                    const colIndex = firstDayOfMonth + day - 1; // Position in 37-column grid

                    if (!lanes[laneIndex]) lanes[laneIndex] = -Infinity;

                    if (lanes[laneIndex] >= colIndex) {
                        foundLane = false;
                        break;
                    }
                }

                if (!foundLane) {
                    laneIndex++;
                }
            }

            // Mark this lane as occupied for all days
            const lanes = monthLaneEnds[monthIdx];
            for (let day = monthStartDay; day <= monthEndDay; day++) {
                const colIndex = firstDayOfMonth + day - 1;
                lanes[laneIndex] = Math.max(lanes[laneIndex] ?? -Infinity, colIndex);
            }

            // Calculate grid positions for day-aligned view
            // Row = month (add 1 for header row) + 1
            const gridRow = monthIdx + 2;

            // Column span: offset by first day + actual day positions
            const startCol = GRID_HEADER_OFFSET + firstDayOfMonth + monthStartDay - 1;
            const endCol = GRID_HEADER_OFFSET + firstDayOfMonth + monthEndDay; // Exclusive end

            const continuesPrev = monthIdx > startMonth;
            const continuesNext = monthIdx < endMonth;

            const bar = createEventBar(
                event,
                laneIndex,
                `${gridRow} / ${gridRow + 1}`,
                `${startCol} / ${endCol}`,
                continuesPrev,
                continuesNext
            );

            const startStr = event.start?.toLocaleString?.() || "";
            const endStr = event.end?.toLocaleString?.() || "";
            bar.title = createEventTooltip(event, startStr, endStr);

            eventsLayer.appendChild(bar);

            // Track max lane for this month
            monthRowHeights[monthIdx] = Math.max(monthRowHeights[monthIdx], laneIndex + 1);
        }
    });

    // Apply dynamic row heights for day-aligned view
    applyDayAlignedRowHeights(monthRowHeights);
}

function renderWeekRowsEvents(year, events) {
    // For week-rows view, track lanes per 4-week row
    // Find the first Monday of the year (or before)
    let startDate = new Date(year, 0, 1);
    const firstDayOfYear = startDate.getDay();
    // Convert Sunday (0) to Monday-based (0=Mon, 6=Sun)
    const daysToSubtract = firstDayOfYear === 0 ? 6 : firstDayOfYear - 1;
    startDate.setDate(startDate.getDate() - daysToSubtract);

    const endDate = new Date(year, 11, 31);

    // Build list of 4-week rows
    const fourWeekRows = [];
    let currentRowStart = new Date(startDate);
    let rowIdx = 0;

    while (currentRowStart <= endDate || rowIdx < 14) {
        const rowEnd = new Date(currentRowStart);
        rowEnd.setDate(rowEnd.getDate() + DAYS_PER_WEEK_ROW - 1); // 28-day period (4 weeks, inclusive)

        fourWeekRows.push({
            index: rowIdx,
            start: new Date(currentRowStart),
            end: rowEnd
        });

        currentRowStart.setDate(currentRowStart.getDate() + DAYS_PER_WEEK_ROW);
        rowIdx++;

        if (rowIdx > 14) break; // Safety limit
    }

    const rowLaneEnds = fourWeekRows.map(() => []);

    const sortedEvents = sortEventsByStartAndDuration(events);

    const { start: yearStart, end: yearEnd } = getYearBoundaries(year);

    sortedEvents.forEach((event) => {
        if (!event.start || !event.end) return;

        const allDay = isAllDayEvent(event);
        const adjustedEnd = allDay ? adjustAllDayEnd(event.end) : event.end;

        const start = new Date(Math.max(event.start.getTime(), yearStart.getTime()));
        const end = new Date(Math.min(adjustedEnd.getTime(), yearEnd.getTime()));

        if (end < start) return;

        // Find which 4-week rows this event spans
        const eventSegments = [];

        for (let i = 0; i < fourWeekRows.length; i++) {
            const row = fourWeekRows[i];

            // Check if event overlaps with this 4-week row
            if (start <= row.end && end >= row.start) {
                const segStart = new Date(Math.max(start.getTime(), row.start.getTime()));
                const segEnd = new Date(Math.min(end.getTime(), row.end.getTime()));

                eventSegments.push({
                    rowIndex: i,
                    start: segStart,
                    end: segEnd
                });
            }
        }

        if (eventSegments.length === 0) return;

        // Render each segment with independent lane assignment per row
        eventSegments.forEach((seg, segIdx) => {
            const row = fourWeekRows[seg.rowIndex];
            const lanes = rowLaneEnds[seg.rowIndex];

            // Calculate day positions within the 28-day row
            const daysSinceRowStart = Math.floor((seg.start - row.start) / MS_PER_DAY);
            const daysSinceRowEnd = Math.floor((seg.end - row.start) / MS_PER_DAY);

            // Find the first available lane for this segment in this row
            let laneIndex = 0;
            // Find the first available lane for this segment's duration
            while (laneIndex < MAX_LANES) {
                if (!lanes[laneIndex]) lanes[laneIndex] = [];
                
                // Check if this lane is available for all days in this segment
                let available = true;
                for (let day = daysSinceRowStart; day <= daysSinceRowEnd && day < DAYS_PER_WEEK_ROW; day++) {
                    if (lanes[laneIndex][day]) {
                        available = false;
                        break;
                    }
                }
                
                if (available) break;
                laneIndex++;
            }

            // Mark all days occupied in this lane
            for (let day = daysSinceRowStart; day <= daysSinceRowEnd && day < DAYS_PER_WEEK_ROW; day++) {
                lanes[laneIndex][day] = true;
            }

            // Calculate grid position
            // Row = row index + 1 (for header) + 1 (1-based grid indexing)
            const gridRow = seg.rowIndex + 2;

            // Columns: no row label, just day columns (1-indexed)
            const startCol = 1 + daysSinceRowStart;
            const endCol = 1 + Math.min(daysSinceRowEnd + 1, DAYS_PER_WEEK_ROW);

            const continuesPrev = segIdx > 0;
            const continuesNext = segIdx < eventSegments.length - 1;

            const bar = createEventBar(
                event,
                laneIndex,
                `${gridRow} / ${gridRow + 1}`,
                `${startCol} / ${endCol}`,
                continuesPrev,
                continuesNext
            );

            const startStr = event.start?.toLocaleString?.() || "";
            const endStr = event.end?.toLocaleString?.() || "";
            bar.title = createEventTooltip(event, startStr, endStr);

            eventsLayer.appendChild(bar);
        });
    });

    // Apply dynamic row heights for week-rows view
    applyWeekRowsRowHeights(rowLaneEnds);
}

function applyDayAlignedRowHeights(monthRowHeights) {
    const rowHeights = calculateRowHeights(monthRowHeights, true);
    
    grid.style.gridTemplateRows = rowHeights;
    eventsLayer.style.gridTemplateRows = rowHeights;
}

function applyWeekRowsRowHeights(weekLaneEnds) {
    // Count the number of lanes used in each row
    const laneCounts = weekLaneEnds.map((lanes) => {
        // lanes is an array where each index represents a lane
        // Count non-empty lanes (lanes that have day occupancy data)
        return lanes.filter(lane => lane && lane.length > 0).length;
    });
    const rowHeights = calculateRowHeights(laneCounts, true);
    
    grid.style.gridTemplateRows = rowHeights;
    eventsLayer.style.gridTemplateRows = rowHeights;
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

async function refreshCalendarData() {
    if (isRefreshing) {
        console.log("[refresh] Already refreshing, skipping");
        return;
    }

    isRefreshing = true;
    refreshButton?.classList.add("refreshing");

    try {
        console.log("[refresh] Refreshing calendar data");
        await loadCalendars();
        await setYear(currentYear);
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
        console.log(`[refresh] Setting up auto-refresh every ${refreshSettings.autoRefreshInterval}ms`);
        autoRefreshTimer = setInterval(() => {
            refreshCalendarData();
        }, refreshSettings.autoRefreshInterval);
    }
}

function setupTabFocusRefresh() {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            console.log("[refresh] Tab became visible, refreshing");
            refreshCalendarData();
        }
    });
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
    refreshSettings = await loadRefreshSettings();
    if (showWeekNumbersInput) {
        showWeekNumbersInput.checked = await loadWeekNumbersPreference();
    }

    // Load view mode preference
    viewMode = await loadViewMode();
    if (viewModeSelect) {
        viewModeSelect.value = viewMode;
    }

    await loadCalendars();

    // Load day indicator preferences
    grayPastDaysEnabled = await loadGrayPastDays();
    highlightCurrentDayEnabled = await loadHighlightCurrentDay();
    if (grayPastDaysInput) grayPastDaysInput.checked = grayPastDaysEnabled;
    if (highlightCurrentDayInput) highlightCurrentDayInput.checked = highlightCurrentDayEnabled;

    await setYear(currentYear);
    updateSelectedSummary();
    setupAutoRefresh();
    setupTabFocusRefresh();

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

    // Add event listener for view mode selector
    onChange(viewModeSelect, async () => {
        viewMode = viewModeSelect?.value || "linear";
        await persistViewMode(viewMode);
        renderCalendar(currentYear);
        const events = await loadEvents(currentYear);
        renderEvents(currentYear, events);
    });

    // Add event listeners for new day indicator toggles
    onChange(grayPastDaysInput, async () => {
        grayPastDaysEnabled = grayPastDaysInput?.checked || false;
        await persistGrayPastDays(grayPastDaysEnabled);
        renderCalendar(currentYear);
    });

    onChange(highlightCurrentDayInput, async () => {
        highlightCurrentDayEnabled = highlightCurrentDayInput?.checked || false;
        await persistHighlightCurrentDay(highlightCurrentDayEnabled);
        renderCalendar(currentYear);
    });

    if (toggleCalendarsBtn) {
        onClick(toggleCalendarsBtn, () => {
            const isExpanded = toggleCalendarsBtn.getAttribute("aria-expanded") === "true";
            setCalendarPanelVisible(!isExpanded);
        });
        const initialExpanded = await loadPanelState();
        setCalendarPanelVisible(initialExpanded);
    }

    onClick(refreshButton, () => refreshCalendarData());

    onClick(themeToggleBtn, () => {
        const modes = ["auto", "light", "dark"];
        const idx = modes.indexOf(themeMode);
        const next = modes[(idx + 1) % modes.length];
        setThemeMode(next);
    });
}

document.addEventListener("DOMContentLoaded", init);
