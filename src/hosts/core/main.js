import { initApp } from "../../core/app.js";
import { EmptyCalendarProvider, setCalendarProvider } from "../../core/providers/calendar-service.js";
import { createWebStorageAdapter, setStorageAdapter } from "../../core/storage-port.js";
import { demoCalendars } from "../../core/demo-calendars.js";

export function start(root = document, mount = null) {
    setStorageAdapter(createWebStorageAdapter({ prefix: "yearView.coreDev." }));
    setCalendarProvider(new EmptyCalendarProvider());
    const config = { demoMode: true, icsCalendars: demoCalendars, selectAllCalendars: true, uiModules: [] };
    if (mount) {
        mount(root, config);
        return;
    }
    initApp(config).catch((err) => console.error("[core-dev] init failed", err));
}
