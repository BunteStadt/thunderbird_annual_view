// "Clear all local data" control for the web host: wipes preferences from
// localStorage, deletes the IndexedDB database, logs out of Google, reloads.

import { deleteWebHostDatabase } from "../web-storage-adapter.js";

const STORAGE_PREFIX = "yearView.storage.";

function clearLocalStorageKeys() {
    const localStorageApi = globalThis.localStorage;
    if (!localStorageApi) {
        return;
    }
    const keys = [];
    for (let i = 0; i < localStorageApi.length; i += 1) {
        const key = localStorageApi.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
            keys.push(key);
        }
    }
    keys.forEach((key) => localStorageApi.removeItem(key));
}

export function setupClearData({ mount, getAuthController }) {
    if (!mount) {
        return { update: () => { } };
    }

    const separator = document.createElement("div");
    separator.className = "separator";

    const button = document.createElement("button");
    button.className = "btn";
    button.dataset.size = "compact";
    button.type = "button";
    button.textContent = "Clear all local data";
    button.title = "Remove all locally stored preferences and uploaded ICS calendars";

    button.addEventListener("click", async () => {
        if (!globalThis.confirm?.("Clear all locally stored data (preferences, uploaded ICS calendars, Google session)?")) {
            return;
        }
        try {
            await getAuthController?.()?.signOutIfConnected?.();
        } catch (err) {
            console.error("[clear-data] Google logout failed", err);
        }
        try {
            clearLocalStorageKeys();
            await deleteWebHostDatabase();
        } catch (err) {
            console.error("[clear-data] clearing storage failed", err);
        }
        globalThis.location?.reload?.();
    });

    mount.appendChild(separator);
    mount.appendChild(button);

    return { update: () => { } };
}
