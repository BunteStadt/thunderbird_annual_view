// Host bootstrap for the year view page. Decides the storage adapter, the
// calendar provider, and which host UI modules to mount, then hands control
// to the core app (app.js).
import { initApp } from "./app.js";
import { createCalendarProvider, setCalendarProvider } from "./calendar-service.js";
import { setupGoogleStandaloneAuth } from "./google-standalone-auth.js";
import { createWebExtensionStorageAdapter, createWebStorageAdapter, setStorageAdapter } from "./storage-port.js";

// Shared URL flags for standalone modes (?dummy=1, ?google=1).
const queryParams = new URLSearchParams(globalThis.location?.search || "");

function isTruthyQueryFlag(value) {
    return value === "" || value === "1" || value === "true";
}

function detectProviderKind() {
    // ?dummy=1 (or a test harness pre-setting the flag) selects the dummy provider.
    if (globalThis.ENABLE_DUMMY_CALENDARS === true || isTruthyQueryFlag(queryParams.get("dummy"))) {
        return "dummy";
    }
    if (isTruthyQueryFlag(queryParams.get("google"))) {
        return "google";
    }
    if (globalThis.browser?.calendar?.calendars?.query && globalThis.browser?.calendar?.items?.query) {
        return "thunderbird";
    }
    return "empty";
}

if (globalThis.browser?.storage?.local) {
    setStorageAdapter(createWebExtensionStorageAdapter());
} else {
    setStorageAdapter(createWebStorageAdapter());
}

const providerKind = detectProviderKind();
setCalendarProvider(createCalendarProvider(providerKind));

const uiModules = [];
if (providerKind === "google") {
    uiModules.push({
        slot: "header-actions",
        mount: (container, api) => setupGoogleStandaloneAuth({
            mount: container,
            getProvider: api.getCalendarProvider,
            refreshCalendars: api.refreshCalendars
        })
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initApp({ uiModules }).catch((err) => console.error("[main] init failed", err));
});
