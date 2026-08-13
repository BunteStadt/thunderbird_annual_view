const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadAdapterModule() {
    const modulePath = path.resolve(__dirname, '../../../src/hosts/saas/src/saas-storage-adapter.js');
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

function installFakeLocalStorage() {
    const data = new Map();
    globalThis.localStorage = {
        get length() {
            return data.size;
        },
        key(index) {
            return [...data.keys()][index] ?? null;
        },
        getItem(key) {
            return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
            data.set(key, String(value));
        },
        removeItem(key) {
            data.delete(key);
        }
    };
    return data;
}

function installFakeIndexedDb() {
    const stores = new Map();

    function makeRequest(executor) {
        const request = {};
        queueMicrotask(() => {
            try {
                request.result = executor();
                request.onsuccess?.();
            } catch (err) {
                request.error = err;
                request.onerror?.();
            }
        });
        return request;
    }

    globalThis.indexedDB = {
        open(name) {
            const request = {};
            queueMicrotask(() => {
                if (!stores.has(name)) {
                    stores.set(name, new Map());
                    request.result = makeDb(name);
                    request.onupgradeneeded?.();
                } else {
                    request.result = makeDb(name);
                }
                request.onsuccess?.();
            });
            return request;
        },
        deleteDatabase(name) {
            return makeRequest(() => {
                stores.delete(name);
                return undefined;
            });
        }
    };

    function makeDb(name) {
        const kv = stores.get(name);
        return {
            objectStoreNames: { contains: () => true },
            createObjectStore() { },
            close() { },
            transaction() {
                return {
                    objectStore() {
                        return {
                            get: (key) => makeRequest(() => kv.get(key)),
                            put: (value, key) => makeRequest(() => { kv.set(key, value); }),
                            delete: (key) => makeRequest(() => { kv.delete(key); })
                        };
                    }
                };
            }
        };
    }

    return stores;
}

test('SaaS adapter routes the ICS key to IndexedDB and preferences to localStorage', async (t) => {
    const localData = installFakeLocalStorage();
    const idbStores = installFakeIndexedDb();
    t.after(() => {
        delete globalThis.localStorage;
        delete globalThis.indexedDB;
    });

    const { createSaasStorageAdapter } = await loadAdapterModule();
    const adapter = createSaasStorageAdapter();

    await adapter.set('viewMode', 'linear');
    assert.equal(localData.get('yearView.storage.viewMode'), JSON.stringify('linear'));
    assert.equal(await adapter.get('viewMode'), 'linear');

    const icsValue = [{ id: 'ics-a', content: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }];
    await adapter.set('icsCalendars', icsValue);
    assert.equal(localData.has('yearView.storage.icsCalendars'), false);
    assert.deepEqual(await adapter.get('icsCalendars'), icsValue);
    assert.deepEqual(idbStores.get('annual-view')?.get('icsCalendars'), icsValue);

    await adapter.remove('icsCalendars');
    assert.equal(await adapter.get('icsCalendars'), undefined);
});

test('SaaS adapter migrates a legacy localStorage ICS entry into IndexedDB', async (t) => {
    const localData = installFakeLocalStorage();
    const idbStores = installFakeIndexedDb();
    t.after(() => {
        delete globalThis.localStorage;
        delete globalThis.indexedDB;
    });

    const legacyValue = [{ id: 'ics-legacy', content: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }];
    localData.set('annualView.storage.icsCalendars', JSON.stringify(legacyValue));

    const { createSaasStorageAdapter } = await loadAdapterModule();
    const adapter = createSaasStorageAdapter();

    assert.deepEqual(await adapter.get('icsCalendars'), legacyValue);
    assert.equal(localData.has('annualView.storage.icsCalendars'), false);
    assert.deepEqual(idbStores.get('annual-view')?.get('icsCalendars'), legacyValue);
});

test('SaaS adapter falls back to localStorage when IndexedDB is unavailable', async (t) => {
    const localData = installFakeLocalStorage();
    delete globalThis.indexedDB;
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    t.after(() => {
        delete globalThis.localStorage;
        console.error = originalError;
    });

    const { createSaasStorageAdapter } = await loadAdapterModule();
    const adapter = createSaasStorageAdapter();

    await adapter.set('icsCalendars', [{ id: 'ics-a', content: 'X' }]);
    assert.equal(localData.has('yearView.storage.icsCalendars'), true);
    assert.ok(errors.some((args) => String(args[0]).includes('IndexedDB unavailable')));
});