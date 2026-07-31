// StoragePort: an injectable key/value storage abstraction so core code never
// talks to a platform storage API directly. Hosts pick the adapter at bootstrap.

let activeStorageAdapter = null;

export function setStorageAdapter(adapter) {
    activeStorageAdapter = adapter ?? null;
}

export function getStorageAdapter() {
    if (!activeStorageAdapter) {
        throw new Error("[storage-port] No storage adapter set. Call setStorageAdapter() during bootstrap.");
    }
    return activeStorageAdapter;
}

// Adapter on top of the WebExtension storage API (browser.storage.local).
export function createWebExtensionStorageAdapter() {
    return {
        async get(key) {
            const stored = await globalThis.browser.storage.local.get(key);
            if (!Object.prototype.hasOwnProperty.call(stored, key)) {
                return undefined;
            }
            return stored[key];
        },
        async set(key, value) {
            await globalThis.browser.storage.local.set({ [key]: value });
        },
        async remove(key) {
            await globalThis.browser.storage.local.remove(key);
        }
    };
}

// Adapter on top of window.localStorage, JSON-serializing values under a prefix.
export function createWebStorageAdapter({ prefix = "annualView.storage." } = {}) {
    return {
        async get(key) {
            const localStorageApi = globalThis.localStorage;
            if (!localStorageApi) {
                return undefined;
            }
            const raw = localStorageApi.getItem(`${prefix}${key}`);
            if (raw == null) {
                return undefined;
            }
            try {
                return JSON.parse(raw);
            } catch (err) {
                console.error("[storage-bridge] parse failed", err);
                return undefined;
            }
        },
        async set(key, value) {
            const localStorageApi = globalThis.localStorage;
            if (!localStorageApi) {
                return;
            }
            localStorageApi.setItem(`${prefix}${key}`, JSON.stringify(value));
        },
        async remove(key) {
            const localStorageApi = globalThis.localStorage;
            if (!localStorageApi) {
                return;
            }
            localStorageApi.removeItem(`${prefix}${key}`);
        }
    };
}
