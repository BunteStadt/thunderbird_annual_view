const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function loadModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', relativePath);
    const source = await fs.readFile(modulePath, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(moduleUrl);
}

test('storage module load/persist helpers use browser.storage.local correctly', async (t) => {
    const storageData = {};
    globalThis.browser = {
        storage: {
            local: {
                async get(key) {
                    if (typeof key === 'string') {
                        return Object.prototype.hasOwnProperty.call(storageData, key)
                            ? { [key]: storageData[key] }
                            : {};
                    }
                    return { ...storageData };
                },
                async set(values) {
                    Object.assign(storageData, values);
                }
            }
        }
    };
    t.after(() => {
        delete globalThis.browser;
    });

    const storage = await loadModule('src/ui/year-view/storage.js');

    const initialSelection = await storage.loadPersistedSelection();
    assert.equal(initialSelection.found, false);
    assert.equal(initialSelection.ids.size, 0);

    await storage.persistSelection(new Set(['calendar-a', 'calendar-b']));
    const persistedSelection = await storage.loadPersistedSelection();
    assert.equal(persistedSelection.found, true);
    assert.deepEqual([...persistedSelection.ids].sort(), ['calendar-a', 'calendar-b']);

    const initialWeekNumbers = await storage.loadWeekNumbersPreference();
    assert.equal(initialWeekNumbers, true);

    await storage.persistWeekNumbersPreference(false);
    const persistedWeekNumbers = await storage.loadWeekNumbersPreference();
    assert.equal(persistedWeekNumbers, false);

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

    const theme = await loadModule('src/ui/year-view/theme.js');

    theme.applyTheme('dark');
    assert.equal(classSet.has('theme-dark'), true);

    theme.applyTheme('light');
    assert.equal(classSet.has('theme-dark'), false);

    assert.equal(theme.detectSystemMode(), 'dark');
});
