// Infinitely scrolling calendar grid.
//
// Every visible row is an independent DOM element (a CSS grid) so rows can be
// prepended and appended without limit while scrolling. In the month-based
// modes (linear, day-aligned) each row is one month, so December of one year
// is directly followed by January of the next. In the week-row modes each row
// is a fixed 4/2/1-week block anchored to a global Monday epoch, so years
// change mid-row (the last day of one year sits next to the first day of the
// next).
//
// Row keys are global integers:
//   - month modes:  key = year * 12 + monthIndex
//   - week-row:     key = floor((dayNumber - WEEK_EPOCH_DAY) / daysPerRow)

import {
    MONTH_NAMES,
    daysInMonth,
    dayNumber,
    dateFromDayNumber,
    getISOWeekNumber,
    isAllDayEvent,
    adjustAllDayEnd,
    eventDurationMs
} from "../domain/date-utils.js";

// Row sizing (rows grow with the number of stacked event lanes).
const ROW_BASE_HEIGHT = 72;
const LANE_SPACING = 26;
const FIRST_LANE_OFFSET = 55;
const ROW_GAP = 1; // Must match the flex gap of .calendar-rows in CSS.

// Virtualization tuning: keep this much rendered beyond the viewport edges,
// and drop rows once they are farther away than the trim distance.
const RENDER_AHEAD_PX = 900;
const TRIM_DISTANCE_PX = 2700;

const WEEK_ROW_DAYS_4 = 28;
const WEEK_ROW_DAYS_2 = 14;
const WEEK_ROW_DAYS_1 = 7;
const WEEK_EPOCH_DAY = dayNumber(new Date(2001, 0, 1)); // A Monday.

const DAY_ALIGNED_COLS = 37; // 6 max weekday offset + 31 days.
const WEEKDAYS_SUNDAY_FIRST = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_MONDAY_FIRST = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function yearOfDay(dayNum) {
    return dateFromDayNumber(dayNum).getFullYear();
}

function rowHeightForLanes(laneCount) {
    if (laneCount <= 0) return ROW_BASE_HEIGHT;
    return Math.max(ROW_BASE_HEIGHT, FIRST_LANE_OFFSET + (laneCount - 1) * LANE_SPACING);
}

// ---------------------------------------------------------------------------
// Cell construction
// ---------------------------------------------------------------------------

function createDisabledCell() {
    const cell = document.createElement("div");
    cell.className = "cell disabled";
    return cell;
}

function createDayCell(date, ctx) {
    const cell = document.createElement("div");
    const weekday = date.getDay();
    cell.className = weekday === 0 || weekday === 6 ? "cell weekend" : "cell";

    const label = document.createElement("span");
    label.className = "day-number";
    label.textContent = date.getDate();
    cell.appendChild(label);

    const dayNum = dayNumber(date);
    cell.dataset.dayNumber = String(dayNum);
    if (ctx.highlightCurrentDay && dayNum === ctx.todayDayNum) {
        cell.classList.add("current-day");
    }
    if (ctx.grayPastDays && dayNum < ctx.todayDayNum) {
        cell.classList.add("past-day");
    }
    if (ctx.showWeekNumber ?? weekday === 1) {
        cell.dataset.weekNumber = String(getISOWeekNumber(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))));
    }
    if (ctx.showWeekNumbers && cell.dataset.weekNumber) {
        const weekLabel = document.createElement("span");
        weekLabel.className = "week-number";
        weekLabel.textContent = cell.dataset.weekNumber;
        cell.appendChild(weekLabel);
    }

    return cell;
}

function appendLabelLines(element, label) {
    for (const part of label.split(" / ")) {
        const line = document.createElement("span");
        line.textContent = part;
        element.appendChild(line);
    }
}

function createMonthLabelCell(meta) {
    const cell = document.createElement("div");
    cell.className = "cell month";

    const name = document.createElement("span");
    name.className = "month-name";
    const monthLabel = meta.monthLabel ?? MONTH_NAMES[meta.month].slice(0, 3);
    appendLabelLines(name, monthLabel);
    cell.appendChild(name);

    const year = document.createElement("span");
    year.className = "month-year";
    appendLabelLines(year, String(meta.yearLabel ?? meta.year));
    cell.appendChild(year);

    return cell;
}

// ---------------------------------------------------------------------------
// Mode implementations
// ---------------------------------------------------------------------------

function monthMeta(key) {
    const year = Math.floor(key / 12);
    const month = key - year * 12;
    const dim = daysInMonth(year, month);
    return {
        year,
        month,
        daysInMonth: dim,
        weekdayOffset: new Date(year, month, 1).getDay(), // 0 = Sunday
        startDayNum: dayNumber(new Date(year, month, 1)),
        endDayNum: dayNumber(new Date(year, month, dim))
    };
}

function monthKeyForDayNumber(dayNum) {
    const d = dateFromDayNumber(dayNum);
    return d.getFullYear() * 12 + d.getMonth();
}

function createWeekRowsMode(className, daysPerRow) {
    return {
        className,
        meta(key) {
            const startDayNum = WEEK_EPOCH_DAY + key * daysPerRow;
            const endDayNum = startDayNum + daysPerRow - 1;
            const startDate = dateFromDayNumber(startDayNum);
            const endDate = dateFromDayNumber(endDayNum);
            const startMonthLabel = MONTH_NAMES[startDate.getMonth()].slice(0, 3);
            const endMonthLabel = MONTH_NAMES[endDate.getMonth()].slice(0, 3);
            const startYearLabel = String(startDate.getFullYear());
            const endYearLabel = String(endDate.getFullYear());
            return {
                startDayNum,
                endDayNum,
                monthLabel: startMonthLabel === endMonthLabel ? startMonthLabel : `${startMonthLabel} / ${endMonthLabel}`,
                yearLabel: startYearLabel === endYearLabel ? startYearLabel : `${startYearLabel} / ${endYearLabel}`
            };
        },
        keyForDayNumber: (dayNum) => Math.floor((dayNum - WEEK_EPOCH_DAY) / daysPerRow),
        keyForYearStart(year) {
            return this.keyForDayNumber(dayNumber(new Date(year, 0, 1)));
        },
        dominantYear: (meta) => yearOfDay(meta.startDayNum + Math.trunc(daysPerRow / 2)),
        headerCells() {
            const cells = [{ className: "cell month", text: "" }];
            for (let week = 0; week < daysPerRow / 7; week += 1) {
                for (const name of WEEKDAYS_MONDAY_FIRST) {
                    cells.push({ className: "weekday-header", text: name });
                }
            }
            return cells;
        },
        columnStart: (meta, dayNum) => dayNum - meta.startDayNum + 2,
        buildCells(row, meta, ctx) {
            row.appendChild(createMonthLabelCell(meta));
            for (let i = 0; i < daysPerRow; i += 1) {
                const date = dateFromDayNumber(meta.startDayNum + i);
                row.appendChild(createDayCell(date, { ...ctx, showWeekNumber: i % 7 === 0 }));
            }
        }
    };
}

const MODE_IMPLS = {
    linear: {
        className: "linear",
        meta: monthMeta,
        keyForDayNumber: monthKeyForDayNumber,
        keyForYearStart: (year) => year * 12,
        dominantYear: (meta) => meta.year,
        headerCells: null,
        // Column 1 is the month label; day D sits in column D + 1.
        columnStart: (meta, dayNum) => dayNum - meta.startDayNum + 2,
        buildCells(row, meta, ctx) {
            row.appendChild(createMonthLabelCell(meta));
            for (let day = 1; day <= 31; day += 1) {
                row.appendChild(
                    day > meta.daysInMonth
                        ? createDisabledCell()
                        : createDayCell(new Date(meta.year, meta.month, day), ctx)
                );
            }
        }
    },

    "day-aligned": {
        className: "day-aligned",
        meta: monthMeta,
        keyForDayNumber: monthKeyForDayNumber,
        keyForYearStart: (year) => year * 12,
        dominantYear: (meta) => meta.year,
        headerCells() {
            const cells = [{ className: "cell month", text: "" }];
            for (let i = 0; i < DAY_ALIGNED_COLS; i += 1) {
                cells.push({ className: "weekday-header", text: WEEKDAYS_SUNDAY_FIRST[i % 7] });
            }
            return cells;
        },
        // Column 1 is the month label; days shift right by the weekday offset.
        columnStart: (meta, dayNum) => dayNum - meta.startDayNum + meta.weekdayOffset + 2,
        buildCells(row, meta, ctx) {
            row.appendChild(createMonthLabelCell(meta));
            for (let i = 0; i < meta.weekdayOffset; i += 1) {
                row.appendChild(createDisabledCell());
            }
            for (let day = 1; day <= meta.daysInMonth; day += 1) {
                row.appendChild(createDayCell(new Date(meta.year, meta.month, day), ctx));
            }
            const trailing = DAY_ALIGNED_COLS - meta.weekdayOffset - meta.daysInMonth;
            for (let i = 0; i < trailing; i += 1) {
                row.appendChild(createDisabledCell());
            }
        }
    },

    "week-rows": createWeekRowsMode("week-rows", WEEK_ROW_DAYS_4),
    "two-week-rows": createWeekRowsMode("two-week-rows", WEEK_ROW_DAYS_2),
    "one-week-rows": createWeekRowsMode("one-week-rows", WEEK_ROW_DAYS_1)
};

// ---------------------------------------------------------------------------
// Event bar rendering
// ---------------------------------------------------------------------------

function alphaFromHex(color, alpha) {
    if (typeof color !== "string") return null;
    const m = color.match(/^#([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyEventColor(el, color) {
    const darkMode = el.closest(".theme-dark") !== null;
    const bg = alphaFromHex(color, darkMode ? 0.45 : 0.25) || color;
    const border = alphaFromHex(color, darkMode ? 0.6 : 0.4) || color;
    el.style.background = `linear-gradient(135deg, ${bg}, ${bg})`;
    el.style.borderColor = border;
}

function formatTooltipDate(date, allDay) {
    if (!(date instanceof Date)) return "";
    return allDay ? date.toLocaleDateString() : date.toLocaleString();
}

function createEventTooltip(event) {
    const allDay = isAllDayEvent(event);
    const endDate = allDay && event.end ? adjustAllDayEnd(event.end) : event.end;
    const lines = [
        event.title,
        event.calendarName ? `Calendar: ${event.calendarName}` : "",
        `${formatTooltipDate(event.start, allDay)} – ${formatTooltipDate(endDate, allDay)}`,
        event.location ? `Location: ${event.location}` : "",
        event.description
    ];
    return lines.filter(Boolean).join("\n");
}

function sortEventsForLayout(events) {
    return [...events].sort((a, b) => {
        const startDiff = (a.start?.getTime?.() ?? 0) - (b.start?.getTime?.() ?? 0);
        if (startDiff !== 0) return startDiff;
        const lenDiff = eventDurationMs(b) - eventDurationMs(a);
        if (lenDiff !== 0) return lenDiff;
        return (a.title || "").localeCompare(b.title || "");
    });
}

// Places event bars for one row and returns the number of lanes used.
function layoutRowEvents(overlay, meta, events, impl) {
    const laneEnds = []; // Per lane: last occupied day number.
    let laneCount = 0;

    for (const event of sortEventsForLayout(events)) {
        if (!event.start || !event.end) continue;

        const allDay = isAllDayEvent(event);
        const endDate = allDay ? adjustAllDayEnd(event.end) : event.end;
        const evStartDay = dayNumber(event.start);
        const evEndDay = dayNumber(endDate);
        if (evEndDay < evStartDay) continue;
        if (evEndDay < meta.startDayNum || evStartDay > meta.endDayNum) continue;

        const segStart = Math.max(evStartDay, meta.startDayNum);
        const segEnd = Math.min(evEndDay, meta.endDayNum);

        let lane = 0;
        while ((laneEnds[lane] ?? -Infinity) >= segStart) lane += 1;
        laneEnds[lane] = segEnd;
        laneCount = Math.max(laneCount, lane + 1);

        const bar = document.createElement("div");
        bar.className = "event";
        if (evStartDay < meta.startDayNum) bar.classList.add("continues-prev");
        if (evEndDay > meta.endDayNum) bar.classList.add("continues-next");
        const eventColor = event.calendarColor || event.color || "#38bdf8";
        bar.dataset.eventColor = eventColor;
        applyEventColor(bar, eventColor);
        bar.style.setProperty("--lane", lane);
        bar.style.gridRow = "1";
        bar.style.gridColumn = `${impl.columnStart(meta, segStart)} / ${impl.columnStart(meta, segEnd) + 1}`;
        bar.textContent = event.title || "(untitled)";
        bar.title = createEventTooltip(event);
        overlay.appendChild(bar);
    }

    return laneCount;
}

// ---------------------------------------------------------------------------
// GridView
// ---------------------------------------------------------------------------

export class GridView {
    /**
     * @param {object} deps
     * @param {HTMLElement} deps.viewport       Scrollable container.
     * @param {HTMLElement} deps.header         Sticky weekday header element.
     * @param {HTMLElement} deps.rowsContainer  Container the rows live in.
     * @param {import("../domain/event-store.js").EventStore} deps.eventStore
     * @param {() => object} deps.getOptions    Returns current display options
     *   ({ showWeekNumbers, grayPastDays, highlightCurrentDay, filters }).
     * @param {(year: number) => void} [deps.onYearChange] Called when the year
     *   at the viewport center changes while scrolling.
     */
    constructor({ viewport, header, rowsContainer, eventStore, getOptions, onYearChange }) {
        this.viewport = viewport;
        this.header = header;
        this.rowsContainer = rowsContainer;
        this.eventStore = eventStore;
        this.getOptions = getOptions;
        this.onYearChange = onYearChange;

        this.mode = "linear";
        this.rows = []; // Ordered, contiguous: [{ key, meta, el, overlay }]
        this.renderGen = 0;
        this._reportedYear = null;
        this._scrollPending = false;
        this._scrollDeferEvents = false;

        this._onScroll = () => this._scheduleScrollWork();
        this._onResize = () => {
            this._syncMonthColumnWidth();
            this._scheduleScrollWork();
        };
        this.viewport.addEventListener("scroll", this._onScroll);
        window.addEventListener("resize", this._onResize);
    }

    destroy() {
        this.viewport.removeEventListener("scroll", this._onScroll);
        window.removeEventListener("resize", this._onResize);
        this.rows = [];
    }

    get _impl() {
        return MODE_IMPLS[this.mode];
    }

    /** Switches the layout mode, keeping the currently centered date in view. */
    setMode(mode, { anchorYear } = {}) {
        const centerDay = this._centerDayNumber();
        this.mode = MODE_IMPLS[mode] ? mode : "linear";
        const key = centerDay != null
            ? this._impl.keyForDayNumber(centerDay)
            : this._impl.keyForYearStart(anchorYear ?? new Date().getFullYear());
        this._rebuild(key);
    }

    /** Scrolls (jumps) so the given year starts at the top of the viewport. */
    showYear(year) {
        this._rebuild(this._impl.keyForYearStart(year), 0, { deferFill: true });
    }

    /** Scrolls (jumps) so the row containing today is at the top. */
    showToday() {
        this._rebuild(this._impl.keyForDayNumber(dayNumber(new Date())));
    }

    /** Rebuilds all rows (cell-level options changed), preserving scroll. */
    rebuild() {
        if (!this.rows.length) return;
        this._rebuild(this.rows[0].key, this.viewport.scrollTop);
    }

    /** Re-applies events on existing rows (filters changed); no scroll jump. */
    refreshEvents() {
        for (const row of this.rows) {
            this._applyEvents(row);
        }
    }

    /** Updates display-only settings without rebuilding rows or event overlays. */
    updateDisplayOptions() {
        const options = this.getOptions();
        const todayDayNum = dayNumber(new Date());
        for (const row of this.rows) {
            row.el.querySelectorAll(".cell[data-day-number]").forEach((cell) => {
                const cellDayNum = Number(cell.dataset.dayNumber);
                cell.classList.toggle("past-day", options.grayPastDays && cellDayNum < todayDayNum);
                cell.classList.toggle("current-day", options.highlightCurrentDay && cellDayNum === todayDayNum);

                const weekNumber = cell.dataset.weekNumber;
                const label = cell.querySelector(".week-number");
                if (options.showWeekNumbers && weekNumber && !label) {
                    const weekLabel = document.createElement("span");
                    weekLabel.className = "week-number";
                    weekLabel.textContent = weekNumber;
                    cell.appendChild(weekLabel);
                } else if (!options.showWeekNumbers) {
                    label?.remove();
                }
            });
        }
    }

    _rebuild(anchorKey, scrollTop = 0, { deferFill = false } = {}) {
        this.renderGen += 1;
        this.rows = [];
        this.viewport.style.removeProperty("--month-column-width");
        this.rowsContainer.textContent = "";
        this._renderHeader();
        this._appendRow(anchorKey, false, !deferFill);

        // Mode changes only need enough rows for the first viewport immediately;
        // the ahead-window fill runs on the next animation frame.
        let guard = 0;
        while (
            guard++ < 60 &&
            (deferFill
                ? this.rows[this.rows.length - 1].el.offsetTop + this.rows[this.rows.length - 1].el.offsetHeight < this.viewport.clientHeight + ROW_BASE_HEIGHT
                : this.viewport.scrollHeight < scrollTop + this.viewport.clientHeight + RENDER_AHEAD_PX)
        ) {
            this._appendRow(this.rows[this.rows.length - 1].key + 1, false, !deferFill);
        }

        this._syncMonthColumnWidth();
        this.viewport.scrollTop = scrollTop;
        this._updateVisibleYear(true);
        if (deferFill) {
            this._scheduleScrollWork({ deferEvents: true });
        } else {
            this._fill();
        }
    }

    _renderHeader() {
        const impl = this._impl;
        this.header.className = `grid-header ${impl.className}`;
        this.header.textContent = "";
        if (!impl.headerCells) {
            this.header.classList.add("hidden");
            return;
        }
        for (const { className, text } of impl.headerCells()) {
            const cell = document.createElement("div");
            cell.className = className;
            cell.textContent = text;
            this.header.appendChild(cell);
        }
    }

    _createRow(key, applyEvents = true) {
        const impl = this._impl;
        const meta = impl.meta(key);
        const el = document.createElement("div");
        el.className = `grid-row ${impl.className}`;
        el.style.height = `${ROW_BASE_HEIGHT}px`;
        impl.buildCells(el, meta, this._cellContext());

        const overlay = document.createElement("div");
        overlay.className = `row-events ${impl.className}`;
        el.appendChild(overlay);

        const row = { key, meta, el, overlay };
        if (applyEvents) this._applyEvents(row);
        return row;
    }

    _cellContext() {
        const options = this.getOptions();
        return {
            showWeekNumbers: options.showWeekNumbers,
            grayPastDays: options.grayPastDays,
            highlightCurrentDay: options.highlightCurrentDay,
            todayDayNum: dayNumber(new Date())
        };
    }

    async _applyEvents(row) {
        const generation = this.renderGen;
        const { filters } = this.getOptions();
        const firstYear = yearOfDay(row.meta.startDayNum);
        const lastYear = yearOfDay(row.meta.endDayNum);

        // Resolves instantly for cached years; the store prefetches ±1 year
        // around this range so slow scrolling never waits on the API.
        const { events } = await this.eventStore.getFilteredEvents(firstYear, lastYear, filters);
        if (generation !== this.renderGen || !row.el.isConnected) return;

        row.overlay.textContent = "";
        const laneCount = layoutRowEvents(row.overlay, row.meta, events, this._impl);
        this.updateEventColors();

        const newHeight = rowHeightForLanes(laneCount);
        const oldHeight = row.el.offsetHeight;
        if (newHeight !== oldHeight) {
            // Keep the viewport visually stable when a row above it grows.
            const isAbove = row.el.offsetTop + oldHeight < this.viewport.scrollTop;
            row.el.style.height = `${newHeight}px`;
            if (isAbove) {
                this.viewport.scrollTop += newHeight - oldHeight;
            }
        }
    }

    updateEventColors() {
        for (const bar of this.rowsContainer.querySelectorAll(".event")) {
            if (bar.dataset.eventColor) applyEventColor(bar, bar.dataset.eventColor);
        }
    }

    _appendRow(key, syncWidth = true, applyEvents = true) {
        const row = this._createRow(key, applyEvents);
        this.rowsContainer.appendChild(row.el);
        this.rows.push(row);
        if (syncWidth) this._syncMonthColumnWidth();
        return row;
    }

    _prependRow(key, syncWidth = true) {
        const row = this._createRow(key);
        this.rowsContainer.insertBefore(row.el, this.rowsContainer.firstChild);
        this.rows.unshift(row);
        if (syncWidth) this._syncMonthColumnWidth();
        return row;
    }

    _syncMonthColumnWidth() {
        this.viewport.style.removeProperty("--month-column-width");
        let width = 0;
        for (const month of this.rowsContainer.querySelectorAll(".month")) {
            width = Math.max(width, month.getBoundingClientRect().width);
        }
        if (width > 0) this.viewport.style.setProperty("--month-column-width", `${width}px`);
    }

    _scheduleScrollWork({ deferEvents = false } = {}) {
        if (this._scrollPending) return;
        this._scrollPending = true;
        this._scrollDeferEvents = deferEvents;
        requestAnimationFrame(() => {
            this._scrollPending = false;
            const shouldDeferEvents = this._scrollDeferEvents;
            this._scrollDeferEvents = false;
            this._updateVisibleYear();
            if (shouldDeferEvents) {
                requestAnimationFrame(() => this._fill({ deferEvents: true }));
                return;
            }
            this._fill();
        });
    }

    // Extends the rendered window around the viewport and trims distant rows.
    _fill({ deferEvents = false } = {}) {
        const vp = this.viewport;
        if (!this.rows.length) return;
        let rowsChanged = false;

        let guard = 0;
        while (guard++ < 60) {
            const last = this.rows[this.rows.length - 1];
            if (last.el.offsetTop + last.el.offsetHeight > vp.scrollTop + vp.clientHeight + RENDER_AHEAD_PX) break;
            this._appendRow(last.key + 1, false, !deferEvents);
            rowsChanged = true;
        }

        guard = 0;
        while (guard++ < 60) {
            const first = this.rows[0];
            if (first.el.offsetTop <= vp.scrollTop - RENDER_AHEAD_PX) break;
            const row = this._prependRow(first.key - 1, false);
            vp.scrollTop += row.el.offsetHeight + ROW_GAP;
            rowsChanged = true;
        }

        while (this.rows.length > 2) {
            const first = this.rows[0];
            if (first.el.offsetTop + first.el.offsetHeight >= vp.scrollTop - TRIM_DISTANCE_PX) break;
            vp.scrollTop -= first.el.offsetHeight + ROW_GAP;
            first.el.remove();
            this.rows.shift();
            rowsChanged = true;
        }

        while (this.rows.length > 2) {
            const last = this.rows[this.rows.length - 1];
            if (last.el.offsetTop <= vp.scrollTop + vp.clientHeight + TRIM_DISTANCE_PX) break;
            last.el.remove();
            this.rows.pop();
            rowsChanged = true;
        }

        if (rowsChanged) this._syncMonthColumnWidth();
        if (deferEvents) this._scheduleEventHydration();
    }

    _scheduleEventHydration() {
        const generation = this.renderGen;
        requestAnimationFrame(() => {
            if (generation !== this.renderGen) return;
            for (const row of this.rows) this._applyEvents(row);
        });
    }

    // Day number at the middle of the row currently centered in the viewport.
    _centerDayNumber() {
        if (!this.rows.length) return null;
        const centerY = this.viewport.scrollTop + this.viewport.clientHeight / 2;
        let candidate = this.rows[0];
        for (const row of this.rows) {
            if (row.el.offsetTop <= centerY) {
                candidate = row;
            } else {
                break;
            }
        }
        return Math.round((candidate.meta.startDayNum + candidate.meta.endDayNum) / 2);
    }

    _updateVisibleYear(force = false) {
        const centerDay = this._centerDayNumber();
        if (centerDay == null) return;
        const impl = this._impl;
        const year = impl.dominantYear(impl.meta(impl.keyForDayNumber(centerDay)));
        if (force || year !== this._reportedYear) {
            this._reportedYear = year;
            this.onYearChange?.(year);
        }
    }
}
