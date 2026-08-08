const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', '..', relativePath);
    const source = await fs.readFile(modulePath, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(moduleUrl);
}

async function importFileModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', '..', relativePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

function createFakeAdapter() {
    const data = new Map();
    return {
        data,
        async get(key) {
            return data.has(key) ? data.get(key) : undefined;
        },
        async set(key, value) {
            data.set(key, value);
        },
        async remove(key) {
            data.delete(key);
        }
    };
}

test('storage module load/persist helpers use the storage adapter correctly', async (t) => {
    const storagePort = await importFileModule('src/core/storage-port.js');
    const fakeAdapter = createFakeAdapter();
    storagePort.setStorageAdapter(fakeAdapter);
    t.after(() => {
        storagePort.setStorageAdapter(null);
    });

    const storage = await importFileModule('src/core/storage.js');

    const initialSelection = await storage.loadPersistedSelection();
    assert.equal(initialSelection.found, false);
    assert.equal(initialSelection.ids.size, 0);

    await storage.persistSelection(new Set(['calendar-a', 'calendar-b']));
    const persistedSelection = await storage.loadPersistedSelection();
    assert.equal(persistedSelection.found, true);
    assert.deepEqual([...persistedSelection.ids].sort(), ['calendar-a', 'calendar-b']);

    const initialAllDayOnly = await storage.loadAllDayOnlyPreference();
    assert.equal(initialAllDayOnly, false);

    await storage.persistAllDayOnlyPreference(true);
    const persistedAllDayOnly = await storage.loadAllDayOnlyPreference();
    assert.equal(persistedAllDayOnly, true);

    const initialMinDuration = await storage.loadMinDurationPreference();
    assert.equal(initialMinDuration, 25);

    await storage.persistMinDurationPreference(12.5);
    const persistedMinDuration = await storage.loadMinDurationPreference();
    assert.equal(persistedMinDuration, 12.5);

    const initialModes = await storage.loadCalendarAllDayModes();
    assert.equal(initialModes.found, false);
    assert.deepEqual(initialModes.modes, {});

    await storage.persistCalendarAllDayModes({
        'calendar-a': 'yes',
        'calendar-b': 'no',
        'calendar-c': 'follow'
    });
    const persistedModes = await storage.loadCalendarAllDayModes();
    assert.equal(persistedModes.found, true);
    assert.deepEqual(persistedModes.modes, {
        'calendar-a': 'yes',
        'calendar-b': 'no',
        'calendar-c': 'follow'
    });

    const initialCalendarDurations = await storage.loadCalendarMinDurationHours();
    assert.equal(initialCalendarDurations.found, false);
    assert.deepEqual(initialCalendarDurations.hours, {});

    await storage.persistCalendarMinDurationHours({
        'calendar-a': -1,
        'calendar-b': 6.5,
        'calendar-c': 'invalid'
    });
    const persistedCalendarDurations = await storage.loadCalendarMinDurationHours();
    assert.equal(persistedCalendarDurations.found, true);
    assert.deepEqual(persistedCalendarDurations.hours, {
        'calendar-a': -1,
        'calendar-b': 6.5
    });

    const initialWeekNumbers = await storage.loadWeekNumbersPreference();
    assert.equal(initialWeekNumbers, true);

    await storage.persistWeekNumbersPreference(false);
    const persistedWeekNumbers = await storage.loadWeekNumbersPreference();
    assert.equal(persistedWeekNumbers, false);

    const initialViewMode = await storage.loadViewMode();
    assert.equal(initialViewMode, 'linear');

    await storage.persistViewMode('two-week-rows');
    const persistedTwoWeekViewMode = await storage.loadViewMode();
    assert.equal(persistedTwoWeekViewMode, 'two-week-rows');

    await storage.persistViewMode('one-week-rows');
    const persistedOneWeekViewMode = await storage.loadViewMode();
    assert.equal(persistedOneWeekViewMode, 'one-week-rows');

    const initialTheme = await storage.loadThemePreference();
    assert.equal(initialTheme, 'auto');

    await storage.persistTheme('dark');
    const persistedTheme = await storage.loadThemePreference();
    assert.equal(persistedTheme, 'dark');
});

test('theme module applies dark class and detects system mode', async (t) => {
    const classSet = new Set();
    globalThis.document = {
        body: {
            classList: {
                add(value) {
                    classSet.add(value);
                },
                remove(value) {
                    classSet.delete(value);
                },
                contains(value) {
                    return classSet.has(value);
                }
            }
        }
    };
    globalThis.window = {
        matchMedia() {
            return { matches: true };
        }
    };
    t.after(() => {
        delete globalThis.document;
        delete globalThis.window;
    });

    const theme = await loadModule('src/core/ui/theme.js');

    theme.applyTheme('dark');
    assert.equal(classSet.has('theme-dark'), true);

    theme.applyTheme('light');
    assert.equal(classSet.has('theme-dark'), false);

    assert.equal(theme.detectSystemMode(), 'dark');
});

test('storage port throws without an adapter and adapters behave correctly', async (t) => {
    const storagePort = await importFileModule('src/core/storage-port.js');
    storagePort.setStorageAdapter(null);
    assert.throws(() => storagePort.getStorageAdapter(), /No storage adapter set/);

    // WebExtension adapter unwraps the { key: value } shape.
    const stored = {};
    globalThis.browser = {
        storage: {
            local: {
                async get(key) {
                    return Object.prototype.hasOwnProperty.call(stored, key) ? { [key]: stored[key] } : {};
                },
                async set(values) {
                    Object.assign(stored, values);
                },
                async remove(key) {
                    delete stored[key];
                }
            }
        }
    };
    t.after(() => {
        delete globalThis.browser;
        delete globalThis.localStorage;
        storagePort.setStorageAdapter(null);
    });

    const webExtAdapter = storagePort.createWebExtensionStorageAdapter();
    assert.equal(await webExtAdapter.get('missing'), undefined);
    await webExtAdapter.set('answer', 42);
    assert.equal(await webExtAdapter.get('answer'), 42);
    await webExtAdapter.remove('answer');
    assert.equal(await webExtAdapter.get('answer'), undefined);

    // Web adapter round-trips JSON with the yearView.storage. prefix.
    const localData = new Map();
    globalThis.localStorage = {
        getItem(key) {
            return localData.has(key) ? localData.get(key) : null;
        },
        setItem(key, value) {
            localData.set(key, String(value));
        },
        removeItem(key) {
            localData.delete(key);
        }
    };

    const webAdapter = storagePort.createWebStorageAdapter();
    assert.equal(await webAdapter.get('missing'), undefined);
    await webAdapter.set('viewMode', 'linear');
    assert.equal(localData.get('yearView.storage.viewMode'), JSON.stringify('linear'));
    assert.equal(await webAdapter.get('viewMode'), 'linear');
    await webAdapter.remove('viewMode');
    assert.equal(await webAdapter.get('viewMode'), undefined);

    // Corrupted JSON is survived (returns undefined, logs an error).
    localData.set('yearView.storage.broken', '{not json');
    assert.equal(await webAdapter.get('broken'), undefined);
});
