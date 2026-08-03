// The host-agnostic UI shell shared by every host page (the Thunderbird add-on
// page and the web app page). Host HTML files are thin wrappers: they keep
// their own <head> (title, meta, favicon, CSS link, bootstrap script) and an
// empty <body>; each host bootstrap calls mountViewShell() before initApp().
// Keeping the markup in exactly one place makes it impossible for host pages
// to drift apart.
//
// All named UI slots (header-actions, sidebar-sections, sidebar-footer,
// content-empty-state) live here too. An empty slot container is inert on
// hosts that mount nothing into it — the add-on page already relied on this
// for header-actions / sidebar-sections, and the web host adds modules for
// the other two.

export const VIEW_SHELL_HTML = `
    <header>
      <div class="controls">
        <button id="toggleCalendars" class="btn" data-size="compact" type="button" aria-expanded="false" aria-controls="calendarFilters">Show options</button>
        <div class="year-nav">
          <button class="btn" type="button" data-size="compact" data-year-step="-1">–</button>
          <input id="yearInput" class="input" type="number" min="1900" max="2999" step="1" />
          <button class="btn" type="button" data-size="compact" data-year-step="1">+</button>
          <button id="todayButton" class="btn" data-size="compact" type="button" title="Jump to the current day">Today</button>
        </div>
        <label for="viewMode" class="view-mode-label">
          <span>View:</span>
          <select id="viewMode" class="input input-compact">
            <option value="linear">compact</option>
            <option value="day-aligned">aligned</option>
            <option value="week-rows">4-week</option>
            <option value="two-week-rows">2-week</option>
            <option value="one-week-rows">1-week</option>
          </select>
        </label>
        <button id="durationFilterToggle" class="btn" data-size="compact" type="button" aria-pressed="true" title="Enable or disable duration and all-day filtering">⏱ Duration filter: On</button>
        <div id="selectedSummary" class="selected-summary" aria-live="polite"></div>
        <button id="refreshButton" class="btn" data-size="compact" type="button" title="Refresh calendar data">⟳ Refresh</button>
        <button id="themeToggle" class="btn" data-size="compact" type="button">Toggle theme</button>
        <div id="providerAuthMount" data-ui-slot="header-actions" hidden></div>
      </div>
    </header>

    <div id="yearLayout" class="year-layout">
      <aside id="calendarFilters" class="calendar-filters collapsed" aria-label="Calendar filters">
        <div class="cal-actions">
          <!-- View options -->
          <label for="showWeekNumbers" class="btn cal-chip-toggle" data-size="compact">
            <input id="showWeekNumbers" type="checkbox" checked />
            <span class="chip-indicator" aria-hidden="true"></span>
            <span class="chip-text">Show week numbers</span>
          </label>
          <label for="grayPastDays" class="btn cal-chip-toggle" data-size="compact">
            <input id="grayPastDays" type="checkbox" />
            <span class="chip-indicator" aria-hidden="true"></span>
            <span class="chip-text">Gray out past days</span>
          </label>
          <label for="highlightCurrentDay" class="btn cal-chip-toggle" data-size="compact">
            <input id="highlightCurrentDay" type="checkbox" />
            <span class="chip-indicator" aria-hidden="true"></span>
            <span class="chip-text">Highlight current day</span>
          </label>
          <div class="separator"></div>
          <!-- Calendar options -->
          <div id="durationFiltersNotice" class="duration-filters-notice" hidden>Duration filter is off. All-day and duration options below are inactive.</div>
          <label for="allDayOnly" class="btn cal-chip-toggle" data-size="compact">
            <input id="allDayOnly" type="checkbox" />
            <span class="chip-indicator" aria-hidden="true"></span>
            <span class="chip-text">Show all-day only</span>
          </label>
          <label for="minDurationHours" class="cal-chip" aria-label="Minimum event length in hours">
            <span>Min event length (h)</span>
            <input id="minDurationHours" class="input" type="number" min="0" step="0.25" value="25" title="Minimum event length in hours." />
            <div class="min-duration-controls">
              <button id="minDurationDown" class="btn" data-size="compact" type="button" aria-label="Decrease minimum length by one hour">–</button>
              <button id="minDurationUp" class="btn" data-size="compact" type="button" aria-label="Increase minimum length by one hour">+</button>
            </div>
          </label>
          <div class="select-buttons">
            <button id="selectAllCals" class="btn" data-size="compact" type="button">Select all</button>
            <button id="deselectAllCals" class="btn" data-size="compact" type="button">Deselect all</button>
          </div>
        </div>
        <div class="cal-list-head" aria-hidden="true">
          <span>Calendar</span>
          <span>All-day</span>
          <span>Min event length</span>
        </div>
        <div class="cal-list" id="calendarList" aria-label="Calendars"></div>
        <div id="providerSidebarMount" data-ui-slot="sidebar-sections"></div>
        <div data-ui-slot="sidebar-footer"></div>
      </aside>

      <main class="main-panel">
        <div data-ui-slot="content-empty-state" class="content-empty-state" hidden></div>
        <div class="calendar-wrap">
          <div id="gridViewport" class="grid-viewport" aria-label="Scrollable annual calendar">
            <div id="gridHeader" class="grid-header hidden" aria-hidden="true"></div>
            <section id="gridRows" class="calendar-rows" aria-label="Calendar months"></section>
          </div>
        </div>
      </main>
    </div>
`;

// Injects the shared shell into <body>. Host bootstraps call this at module
// scope (module scripts run after parsing, so <body> exists) before initApp().
export function mountViewShell(rootDocument = document) {
    const body = rootDocument?.body;
    if (!body) {
        throw new Error("[view-shell] no <body> found to mount the view shell into");
    }
    body.insertAdjacentHTML?.("afterbegin", VIEW_SHELL_HTML);
}
