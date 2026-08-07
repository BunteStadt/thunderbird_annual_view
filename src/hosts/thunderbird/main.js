// Thunderbird host bootstrap for the year view page. Wires the WebExtension
// storage adapter and the Thunderbird experiment-API calendar provider, mounts
// the shared view shell, then hands control to the core app (app.js).
import { initApp } from "../../core/app.js";
import { createCalendarProvider, registerProviderFactory, setCalendarProvider } from "../../core/providers/calendar-service.js";
import { createWebExtensionStorageAdapter, setStorageAdapter } from "../../core/storage-port.js";
import { ThunderbirdCalendarProvider } from "./thunderbird-calendar-provider.js";

export function start(root = document, mount = null) {
    setStorageAdapter(createWebExtensionStorageAdapter());
    registerProviderFactory("thunderbird", () => new ThunderbirdCalendarProvider());
    setCalendarProvider(createCalendarProvider("thunderbird"));
    const config = { uiModules: [] };
    if (mount) {
        mount(root, config);
        return;
    }
    initApp(config).catch((err) => console.error("[main] init failed", err));
}
