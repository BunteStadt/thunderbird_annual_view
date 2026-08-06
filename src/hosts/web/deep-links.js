// Year deep links for the web host: #/2026 navigates to that year.

export const YEAR_MIN = 1900;
export const YEAR_MAX = 2999;

// Parses a location hash like "#/2026" and returns the year, or null.
export function parseYearHash(hash) {
    const match = /^#\/(\d{4})$/.exec(hash || "");
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    if (!Number.isFinite(year) || year < YEAR_MIN || year > YEAR_MAX) {
        return null;
    }
    return year;
}

export function formatYearHash(year) {
    return `#/${year}`;
}

// Keeps location.hash in sync with the visible year without polluting history.
export function setupDeepLinks(appApi) {
    globalThis.addEventListener?.("hashchange", () => {
        const year = parseYearHash(globalThis.location?.hash);
        if (year !== null && year !== appApi.getCurrentYear()) {
            appApi.jumpToYear(year);
        }
    });
}

export function updateYearHash(year) {
    const target = formatYearHash(year);
    if (globalThis.location && globalThis.location.hash !== target) {
        globalThis.history?.replaceState?.(null, "", target);
    }
}
