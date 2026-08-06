const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadAppModule() {
    const modulePath = path.resolve(__dirname, '../../src/core/app.js');
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

function createFakeSlotElement(name) {
    return {
        attributes: { 'data-ui-slot': name },
        getAttribute(attr) {
            return this.attributes[attr] ?? null;
        }
    };
}

test('resolveUiSlots builds a slot map from data-ui-slot elements', async () => {
    const { resolveUiSlots } = await loadAppModule();

    const headerSlot = createFakeSlotElement('header-actions');
    const sidebarSlot = createFakeSlotElement('sidebar-sections');
    const unnamed = createFakeSlotElement('');
    const fakeDocument = {
        querySelectorAll(selector) {
            assert.equal(selector, '[data-ui-slot]');
            return [headerSlot, sidebarSlot, unnamed];
        }
    };

    const slots = resolveUiSlots(fakeDocument);

    assert.equal(slots.size, 2);
    assert.equal(slots.get('header-actions'), headerSlot);
    assert.equal(slots.get('sidebar-sections'), sidebarSlot);
});

test('mountUiModules mounts modules into their slot containers and skips unknown slots', async (t) => {
    const { mountUiModules } = await loadAppModule();

    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    t.after(() => {
        console.error = originalError;
    });

    const headerSlot = createFakeSlotElement('header-actions');
    const slots = new Map([['header-actions', headerSlot]]);
    const appApi = { marker: 'app-api' };

    const mountedArgs = [];
    const modules = [
        {
            slot: 'header-actions',
            mount(container, api) {
                mountedArgs.push([container, api]);
                return { update: () => {} };
            }
        },
        {
            slot: 'does-not-exist',
            mount() {
                throw new Error('must not be called');
            }
        }
    ];

    const mounted = mountUiModules(modules, slots, appApi);

    assert.equal(mounted.length, 1);
    assert.equal(typeof mounted[0].update, 'function');
    assert.deepEqual(mountedArgs, [[headerSlot, appApi]]);
    assert.equal(errors.length, 1);
    assert.ok(String(errors[0][1]).includes('does-not-exist'));
});
