export async function loadPersistedSelection() {
    try {
        const stored = await browser.storage.local.get("selectedCalendarIds");
        if (!Object.prototype.hasOwnProperty.call(stored, "selectedCalendarIds")) {
            return { ids: new Set(), found: false };
        }
        const ids = Array.isArray(stored.selectedCalendarIds) ? stored.selectedCalendarIds : [];
        return { ids: new Set(ids), found: true };
    } catch (err) {
        console.error("[storage] load selection failed", err);
        return { ids: new Set(), found: false };
    }
}

export async function persistSelection(selectedIds) {
    try {
        await browser.storage.local.set({ selectedCalendarIds: Array.from(selectedIds) });
    } catch (err) {
        console.error("[storage] save selection failed", err);
    }
}

export async function loadPanelState() {
    try {
        const stored = await browser.storage.local.get("calendarPanelExpanded");
        if (!Object.prototype.hasOwnProperty.call(stored, "calendarPanelExpanded")) {
            return false;
        }
        return Boolean(stored.calendarPanelExpanded);
    } catch (err) {
        console.error("[storage] load panel state failed", err);
        return false;
    }
}

export async function persistPanelState(expanded) {
    try {
        await browser.storage.local.set({ calendarPanelExpanded: !!expanded });
    } catch (err) {
        console.error("[storage] save panel state failed", err);
    }
}

export async function loadThemePreference() {
    try {
        const stored = await browser.storage.local.get("uiThemeOverride");
        if (Object.prototype.hasOwnProperty.call(stored, "uiThemeOverride")) {
            const v = stored.uiThemeOverride;
            if (v === "light" || v === "dark" || v === "auto") return v;
        }
    } catch (err) {
        console.error("[storage] load theme failed", err);
    }
    return "auto";
}

export async function persistTheme(theme) {
    try {
        await browser.storage.local.set({ uiThemeOverride: theme });
    } catch (err) {
        console.error("[storage] save theme failed", err);
    }
}

export async function loadGrayPastDays() {
    try {
        const stored = await browser.storage.local.get("grayPastDays");
        if (Object.prototype.hasOwnProperty.call(stored, "grayPastDays")) {
            return Boolean(stored.grayPastDays);
        }
    } catch (err) {
        console.error("[storage] load gray past days failed", err);
    }
    return false;
}

export async function persistGrayPastDays(enabled) {
    try {
        await browser.storage.local.set({ grayPastDays: !!enabled });
    } catch (err) {
        console.error("[storage] save gray past days failed", err);
    }
}

export async function loadHighlightCurrentDay() {
    try {
        const stored = await browser.storage.local.get("highlightCurrentDay");
        if (Object.prototype.hasOwnProperty.call(stored, "highlightCurrentDay")) {
            return Boolean(stored.highlightCurrentDay);
        }
    } catch (err) {
        console.error("[storage] load highlight current day failed", err);
    }
    return false;
}

export async function persistHighlightCurrentDay(enabled) {
    try {
        await browser.storage.local.set({ highlightCurrentDay: !!enabled });
    } catch (err) {
        console.error("[storage] save highlight current day failed", err);
    }
}

export async function loadRefreshSettings() {
    try {
        const stored = await browser.storage.local.get("refreshSettings");
        if (Object.prototype.hasOwnProperty.call(stored, "refreshSettings")) {
            const settings = stored.refreshSettings;
            return {
                autoRefreshEnabled: settings.autoRefreshEnabled !== false,
                autoRefreshInterval: settings.autoRefreshInterval || 300000 // 5 minutes default
            };
        }
    } catch (err) {
        console.error("[storage] load refresh settings failed", err);
    }
    return {
        autoRefreshEnabled: true,
        autoRefreshInterval: 300000 // 5 minutes default
    };
}

export async function persistRefreshSettings(settings) {
    try {
        await browser.storage.local.set({ refreshSettings: settings });
    } catch (err) {
        console.error("[storage] save refresh settings failed", err);
    }
}

