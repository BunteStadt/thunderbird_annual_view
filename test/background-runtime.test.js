const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('background script loads and click handler executes without console errors', async () => {
    const backgroundPath = path.resolve(__dirname, '../src/background/background.js');
    const source = fs.readFileSync(backgroundPath, 'utf8');

    const consoleErrors = [];
    let clickHandler = null;

    const browser = {
        runtime: {
            getURL: (urlPath) => `moz-extension://test/${urlPath}`
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

    const context = vm.createContext({
        browser,
        console: {
            log() {},
            error(...args) {
                consoleErrors.push(args);
            }
        },
        globalThis: {}
    });

    vm.runInContext(source, context, { filename: 'background.js' });
    assert.equal(typeof clickHandler, 'function');

    await clickHandler();
    assert.deepEqual(consoleErrors, []);
});
