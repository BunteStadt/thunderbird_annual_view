// Caching layer between the calendar API and the renderer.
//
// The infinite-scrolling grid can show several years at once, so events are
// fetched and cached per year. Raw events for *all* calendars are cached and
// every display filter (calendar selection, all-day, minimum duration) is
// applied on read — so toggling a filter or a calendar never refetches.
// Prefetching keeps a one-year margin around the visible range so slow
// scrolling never hits a fetch stall at a year boundary.

import { fetchCalendarEvents } from "./calendar-service.js";
import { normalizeEvents, eventDurationMs } from "./date-utils.js";

const PREFETCH_MARGIN_YEARS = 1;

export class EventStore {
    constructor() {
        // year -> Promise<event[]> (raw, unfiltered, normalized)
        this._cache = new Map();
        this._generation = 0;
    }

    // Drops all cached events, e.g. after a manual refresh.
    invalidate() {
        this._cache.clear();
        this._generation += 1;
    }

    _fetchYear(year) {
        if (!this._cache.has(year)) {
            const generation = this._generation;
            const promise = (async () => {
                const raw = await fetchCalendarEvents(year, { calendarIds: [], allDayOnly: false });
                return normalizeEvents(raw);
            })().catch((err) => {
                console.error(`[EventStore] fetch failed for ${year}`, err);
                // Allow retries after a failure (unless invalidated meanwhile).
                if (this._generation === generation) this._cache.delete(year);
                return [];
            });
            this._cache.set(year, promise);
        }
        return this._cache.get(year);
    }

    // Fires fetches for the given range plus margin without awaiting them.
    prefetch(firstYear, lastYear) {
        for (let y = firstYear - PREFETCH_MARGIN_YEARS; y <= lastYear + PREFETCH_MARGIN_YEARS; y += 1) {
            this._fetchYear(y);
        }
    }

    // Returns raw events for [firstYear, lastYear], deduplicated across year
    // boundaries (an event spanning New Year is reported by both year queries).
    async getRawEvents(firstYear, lastYear) {
        this.prefetch(firstYear, lastYear);

        const perYear = await Promise.all(
            Array.from({ length: lastYear - firstYear + 1 }, (_, i) => this._fetchYear(firstYear + i))
        );

        const seen = new Set();
        const events = [];
        for (const yearEvents of perYear) {
            for (const ev of yearEvents) {
                // Key includes the start time because occurrences of a
                // recurring event can share the same id.
                const key = `${ev.id ?? `${ev.calendarId}|${ev.title}`}|${ev.start?.getTime?.()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                events.push(ev);
            }
        }
        return events;
    }

    // Applies display filters and returns both the visible events and stats
    // for the "Filtered out X of Y" summary.
    async getFilteredEvents(firstYear, lastYear, filters) {
        const {
            calendarIds = [],
            allDayOnly = false,
            calendarAllDayModes = {},
            getMinDurationMs = () => 0
        } = filters;

        if (!calendarIds.length) {
            return { events: [], stats: { filteredOut: 0, total: 0 } };
        }

        const raw = await this.getRawEvents(firstYear, lastYear);
        const wanted = new Set(calendarIds);

        const resolveAllDayOnly = (calendarId) => {
            const mode = calendarAllDayModes[calendarId];
            if (mode === "yes") return true;
            if (mode === "no") return false;
            return allDayOnly;
        };

        const candidates = raw.filter((ev) => wanted.has(ev.calendarId));
        const events = candidates.filter((ev) => {
            if (resolveAllDayOnly(ev.calendarId) && !ev.isAllDay) return false;
            return eventDurationMs(ev) >= getMinDurationMs(ev.calendarId);
        });

        return {
            events,
            stats: {
                filteredOut: candidates.length - events.length,
                total: candidates.length
            }
        };
    }
}
