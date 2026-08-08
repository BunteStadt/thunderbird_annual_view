// Composite storage adapter for the web host: preferences live in
// localStorage, while (potentially large) uploaded ICS content is stored in
// IndexedDB. Both sides implement the StoragePort interface.

import { createWebStorageAdapter } from "../../core/storage-port.js";

const ICS_STORAGE_KEY = "icsCalendars";
const DB_NAME = "annual-view";
const DB_STORE = "kv";
const LEGACY_PREFIX = "annualView.storage.";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function createIndexedDbAdapter() {
    async function withStore(mode, operation) {
        const db = await openDatabase();
        try {
            const transaction = db.transaction(DB_STORE, mode);
            const store = transaction.objectStore(DB_STORE);
            return await operation(store);
        } finally {
            db.close();
        }
    }

    return {
        async get(key) {
            return withStore("readonly", (store) => requestToPromise(store.get(key)));
        },
        async set(key, value) {
            await withStore("readwrite", (store) => requestToPromise(store.put(value, key)));
        },
        async remove(key) {
            await withStore("readwrite", (store) => requestToPromise(store.delete(key)));
        }
    };
}

export function deleteWebHostDatabase() {
    if (!globalThis.indexedDB) {
        return Promise.resolve();
    }
    return requestToPromise(globalThis.indexedDB.deleteDatabase(DB_NAME)).catch((err) => {
        console.error("[web-storage] delete database failed", err);
    });
}

// Routes the uploaded-ICS descriptor key to IndexedDB and every other key to
// the localStorage-backed web adapter. Falls back to localStorage entirely
// when IndexedDB is unavailable.
export function createWebHostStorageAdapter({ icsKey = ICS_STORAGE_KEY } = {}) {
    const preferenceAdapter = createWebStorageAdapter();
    const legacyPreferenceAdapter = createWebStorageAdapter({ prefix: LEGACY_PREFIX });

    if (!globalThis.indexedDB) {
        console.error("[web-storage] IndexedDB unavailable, falling back to localStorage");
        return preferenceAdapter;
    }

    const icsAdapter = createIndexedDbAdapter();
    let migrated = false;

    // Silent migration: move a legacy localStorage ICS entry into IndexedDB.
    async function migrateLegacyIcsValue() {
        if (migrated) {
            return;
        }
        migrated = true;
        try {
            const existing = await icsAdapter.get(icsKey);
            if (existing !== undefined) {
                return;
            }
            const legacy = await legacyPreferenceAdapter.get(icsKey);
            if (legacy !== undefined) {
                await icsAdapter.set(icsKey, legacy);
                await preferenceAdapter.remove(icsKey);
                globalThis.localStorage?.removeItem?.(`${LEGACY_PREFIX}${icsKey}`);
            }
        } catch (err) {
            console.error("[web-storage] ICS migration failed", err);
        }
    }

    return {
        async get(key) {
            if (key === icsKey) {
                await migrateLegacyIcsValue();
                return icsAdapter.get(key);
            }
            const value = await preferenceAdapter.get(key);
            return value === undefined ? legacyPreferenceAdapter.get(key) : value;
        },
        async set(key, value) {
            if (key === icsKey) {
                await icsAdapter.set(key, value);
                return;
            }
            await preferenceAdapter.set(key, value);
            await legacyPreferenceAdapter.remove(key);
        },
        async remove(key) {
            if (key === icsKey) {
                await icsAdapter.remove(key);
                return;
            }
            await preferenceAdapter.remove(key);
            await legacyPreferenceAdapter.remove(key);
        }
    };
}
