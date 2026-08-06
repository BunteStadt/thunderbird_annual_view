// Thunderbird host bootstrap for the year view page. Wires the WebExtension
// storage adapter and the Thunderbird experiment-API calendar provider, mounts
// the shared view shell, then hands control to the core app (app.js).
import { initApp } from "../../core/app.js";
import { createCalendarProvider, registerProviderFactory, setCalendarProvider } from "../../core/providers/calendar-service.js";
import { createWebExtensionStorageAdapter, setStorageAdapter } from "../../core/storage-port.js";
import { ThunderbirdCalendarProvider } from "./thunderbird-calendar-provider.js";

export function start() {
    setStorageAdapter(createWebExtensionStorageAdapter());
    registerProviderFactory("thunderbird", () => new ThunderbirdCalendarProvider());
    setCalendarProvider(createCalendarProvider("thunderbird"));
    initApp({ uiModules: [] }).catch((err) => console.error("[main] init failed", err));
}
