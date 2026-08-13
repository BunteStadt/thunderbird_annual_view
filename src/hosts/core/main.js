import { initApp } from "../../core/app.js";
import { createCalendarProvider, setCalendarProvider } from "../../core/providers/calendar-service.js";
import { createWebStorageAdapter, setStorageAdapter } from "../../core/storage-port.js";

export function start(root = document, mount = null) {
    setStorageAdapter(createWebStorageAdapter({ prefix: "yearView.coreDev." }));
    setCalendarProvider(createCalendarProvider("dummy"));
    const config = { selectAllCalendars: true, uiModules: [] };
    if (mount) {
        mount(root, config);
        return;
    }
    initApp(config).catch((err) => console.error("[core-dev] init failed", err));
}
