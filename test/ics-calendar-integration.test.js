const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadIntegrationModule() {
    const modulePath = path.resolve(__dirname, '../src/ui/year-view/ics-calendar-integration.js');
    await fs.access(modulePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

test('ICS calendar integration loads stored calendars and renders upload controls in a generic mount', async (t) => {
    const storageData = {
        icsCalendars: [
            {
                id: 'ics-stored',
                name: 'Stored',
                color: null,
                content: 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:stored\nSUMMARY:Stored\nDTSTART;VALUE=DATE:20260101\nDTEND;VALUE=DATE:20260102\nEND:VEVENT\nEND:VCALENDAR'
            }
        ]
    };

    const fileInput = {
        files: null,
        value: '',
        hidden: false,
        type: '',
        accept: '',
        multiple: false,
        listeners: {},
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        }
    };
    const uploadButton = {
        className: '',
        dataset: {},
        type: '',
        textContent: '',
        listeners: {},
        clicked: false,
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        }
    };
    fileInput.click = () => {
        fileInput.clicked = true;
    };
    uploadButton.click = () => {
        uploadButton.clicked = true;
    };

    const mount = {
        children: [],
        replaceChildren(...children) {
            this.children = children;
        }
    };

    globalThis.browser = {
        storage: {
            local: {
                async get(key) {
                    return Object.prototype.hasOwnProperty.call(storageData, key)
                        ? { [key]: storageData[key] }
                        : {};
                },
                async set(values) {
                    Object.assign(storageData, values);
                }
            }
        }
    };

    globalThis.document = {
        createElement(tagName) {
            if (tagName === 'input') {
                return fileInput;
            }
            if (tagName === 'button') {
                return uploadButton;
            }
            return {
                className: '',
                children: [],
                appendChild(child) {
                    this.children.push(child);
                    return child;
                }
            };
        }
    };

    t.after(() => {
        delete globalThis.browser;
        delete globalThis.document;
    });

    const { setupIcsCalendarIntegration } = await loadIntegrationModule();

    let refreshCount = 0;
    const integration = setupIcsCalendarIntegration({
        mount,
        onCalendarsChanged: async () => {
            refreshCount += 1;
        }
    });

    await integration.initialize();

    assert.equal(mount.children.length, 3);
    assert.equal(uploadButton.textContent, 'Upload ICS');
    assert.equal(fileInput.hidden, true);
    assert.equal(refreshCount, 0);
});

test('ICS calendar integration persists uploaded files and triggers refresh callback', async (t) => {
    const storageData = {};

    const fileInput = {
        files: null,
        value: '',
        hidden: false,
        type: '',
        accept: '',
        multiple: false,
        listeners: {},
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        click() { }
    };
    const uploadButton = {
        className: '',
        dataset: {},
        type: '',
        textContent: '',
        listeners: {},
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        }
    };
    const mount = {
        replaceChildren() { }
    };

    globalThis.browser = {
        storage: {
            local: {
                async get(key) {
                    return Object.prototype.hasOwnProperty.call(storageData, key)
                        ? { [key]: storageData[key] }
                        : {};
                },
                async set(values) {
                    Object.assign(storageData, values);
                }
            }
        }
    };

    globalThis.document = {
        createElement(tagName) {
            if (tagName === 'input') {
                return fileInput;
            }
            if (tagName === 'button') {
                return uploadButton;
            }
            return {
                className: '',
                appendChild(child) {
                    return child;
                }
            };
        }
    };

    t.after(() => {
        delete globalThis.browser;
        delete globalThis.document;
    });

    const { setupIcsCalendarIntegration } = await loadIntegrationModule();

    let refreshCount = 0;
    const integration = setupIcsCalendarIntegration({
        mount,
        onCalendarsChanged: async () => {
            refreshCount += 1;
        }
    });

    await integration.initialize();
    fileInput.files = [{
        name: 'work.ics',
        async text() {
            return 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:work\nSUMMARY:Work\nDTSTART;VALUE=DATE:20260101\nDTEND;VALUE=DATE:20260102\nEND:VEVENT\nEND:VCALENDAR';
        }
    }];
    await fileInput.listeners.change();

    assert.equal(refreshCount, 1);
    assert.equal(Array.isArray(storageData.icsCalendars), true);
    assert.equal(storageData.icsCalendars.length, 1);
    assert.equal(storageData.icsCalendars[0].name, 'work');
    assert.equal(storageData.icsCalendars[0].content.includes('BEGIN:VCALENDAR'), true);
    assert.equal(fileInput.value, '');
});
