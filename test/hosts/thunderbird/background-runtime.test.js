const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('background script loads and click handler executes without console errors', async () => {
    const backgroundPath = path.resolve(__dirname, '../../../src/hosts/thunderbird/background.js');
    const source = fs.readFileSync(backgroundPath, 'utf8');

    const consoleErrors = [];
    let clickHandler = null;

    const browser = {
        runtime: {
            getURL: (urlPath) => `moz-extension://test/${urlPath}`,
            onInstalled: { addListener() {} },
            onStartup: { addListener() {} }
        },
        action: {
            onClicked: {
                addListener(handler) {
                    clickHandler = handler;
                }
            }
        },
        spaces: {
            async query() {
                return [];
            },
            async create() {
                return { id: 1 };
            },
            async open() {
                return undefined;
            }
        }
    };

    const availableResources = new Set([
        'moz-extension://test/src/hosts/thunderbird/year-view.html',
        'moz-extension://test/assets/icons/annual_view_prefers-color.svg'
    ]);

    const context = vm.createContext({
        browser,
        fetch: async (url) => ({ ok: availableResources.has(url) }),
        console: {
            log() {},
            error(...args) {
                consoleErrors.push(args);
            }
        }
    });
    context.globalThis = context;

    vm.runInContext(source, context, { filename: 'background.js' });
    assert.equal(typeof clickHandler, 'function');

    await clickHandler();
    assert.deepEqual(consoleErrors, []);
});
