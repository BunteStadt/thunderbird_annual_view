// Web host bootstrap for the annual view. Uses client-side storage only
// (localStorage + IndexedDB), the Google provider on demand, and host UI
// modules for Google login, empty state, and clearing local data.
import { initApp } from "../../core/app.js";
import { createCalendarProvider, setCalendarProvider } from "../../core/providers/calendar-service.js";
import { GoogleCalendarProvider } from "../../core/providers/google-calendar-provider.js";
import { setStorageAdapter } from "../../core/storage-port.js";
import { parseYearHash, setupDeepLinks, updateYearHash } from "./deep-links.js";
import { setupClearData } from "./ui/clear-data.js";
import { setupEmptyState } from "./ui/empty-state.js";
import { setupGoogleStandaloneAuth } from "./ui/google-standalone-auth.js";
import { createWebHostStorageAdapter } from "./web-storage-adapter.js";

// URL flags: ?dummy=1 loads demo data. ?google=1 is kept as a no-op alias for
// old links — the Google login is always available in the header.
const queryParams = new URLSearchParams(globalThis.location?.search || "");

function isTruthyQueryFlag(value) {
    return value === "" || value === "1" || value === "true";
}

const dummyMode = globalThis.ENABLE_DUMMY_CALENDARS === true || isTruthyQueryFlag(queryParams.get("dummy"));

setStorageAdapter(createWebHostStorageAdapter());

// The Google provider instance is created up front so its auth state survives
// connect/disconnect cycles; it only becomes the active provider on connect.
const googleProvider = new GoogleCalendarProvider();

setCalendarProvider(dummyMode ? createCalendarProvider("dummy") : createCalendarProvider("empty"));

let authController = null;

const uiModules = [
    {
        slot: "header-actions",
        mount: (container, api) => {
            authController = setupGoogleStandaloneAuth({
                mount: container,
                getProvider: () => googleProvider,
                refreshCalendars: api.refreshCalendars,
                onAuthChange: (authenticated) => {
                    if (dummyMode) {
                        return;
                    }
                    setCalendarProvider(authenticated ? googleProvider : createCalendarProvider("empty"));
                }
            });
            return authController;
        }
    },
    {
        slot: "content-empty-state",
        mount: (container, api) => setupEmptyState({
            mount: container,
            listCalendars: api.listCalendars
        })
    },
    {
        slot: "sidebar-footer",
        mount: (container) => setupClearData({
            mount: container,
            getAuthController: () => authController
        })
    }
];

document.addEventListener("DOMContentLoaded", () => {
    const initialYear = parseYearHash(globalThis.location?.hash);
    initApp({
        uiModules,
        initialYear: initialYear ?? undefined,
        onYearChange: (year) => updateYearHash(year)
    }).then((appApi) => {
        setupDeepLinks(appApi);
    }).catch((err) => console.error("[main] init failed", err));
});
