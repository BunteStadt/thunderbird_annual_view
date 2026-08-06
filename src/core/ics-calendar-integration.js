import { setIcsCalendars } from "./providers/calendar-service.js";
import { getStorageAdapter } from "./storage-port.js";

const ICS_STORAGE_KEY = "icsCalendars";

function sanitizeCalendarDescriptors(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((calendar) => calendar && typeof calendar.id === "string" && typeof calendar.content === "string");
}

async function loadStoredIcsCalendars() {
    try {
        const stored = await getStorageAdapter().get(ICS_STORAGE_KEY);
        if (stored === undefined) {
            return [];
        }
        return sanitizeCalendarDescriptors(stored);
    } catch (err) {
        console.error("[ics-upload] load stored calendars failed", err);
        return [];
    }
}

async function persistStoredIcsCalendars(calendars) {
    try {
        await getStorageAdapter().set(ICS_STORAGE_KEY, sanitizeCalendarDescriptors(calendars));
    } catch (err) {
        console.error("[ics-upload] save stored calendars failed", err);
    }
}

async function createCalendarDescriptors(files) {
    const timestamp = Date.now();
    return Promise.all(
        Array.from(files || []).map(async (file, index) => {
            const content = await file.text();
            const baseName = file.name.replace(/\.ics$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-");
            return {
                id: `ics-${baseName}-${timestamp}-${index}`,
                name: file.name.replace(/\.ics$/i, ""),
                color: null,
                content
            };
        })
    );
}

export function setupIcsCalendarIntegration({ mount, onCalendarsChanged } = {}) {
    let calendars = [];

    const fileInput = globalThis.document?.createElement?.("input") ?? null;
    const uploadButton = globalThis.document?.createElement?.("button") ?? null;

    async function syncStoredCalendars() {
        calendars = await loadStoredIcsCalendars();
        setIcsCalendars(calendars);
    }

    async function updateCalendars(nextCalendars) {
        calendars = sanitizeCalendarDescriptors(nextCalendars);
        await persistStoredIcsCalendars(calendars);
        setIcsCalendars(calendars);
        await onCalendarsChanged?.(calendars);
    }

    async function handleFiles(files) {
        if (!files?.length) {
            return;
        }
        const nextCalendars = calendars.concat(await createCalendarDescriptors(files));
        await updateCalendars(nextCalendars);
        if (fileInput) {
            fileInput.value = "";
        }
    }

    function render() {
        if (!mount || !fileInput || !uploadButton) {
            return;
        }

        fileInput.type = "file";
        fileInput.accept = ".ics";
        fileInput.multiple = true;
        fileInput.hidden = true;

        uploadButton.className = "btn";
        uploadButton.dataset.size = "compact";
        uploadButton.type = "button";
        uploadButton.textContent = "Upload ICS";

        const separator = globalThis.document.createElement("div");
        separator.className = "separator";

        const buttonRow = globalThis.document.createElement("div");
        buttonRow.className = "select-buttons";
        buttonRow.appendChild(uploadButton);

        mount.replaceChildren(separator, fileInput, buttonRow);
    }

    uploadButton?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async () => {
        await handleFiles(fileInput.files);
    });

    return {
        async initialize() {
            await syncStoredCalendars();
            render();
        },

        async removeCalendar(id) {
            await updateCalendars(calendars.filter((c) => c.id !== id));
        }
    };
}
