const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadModule(relativePath) {
    const modulePath = path.resolve(__dirname, '..', relativePath);
    return import(`file://${modulePath.replace(/\\/g, '/')}`);
}

function createFakeElement(tagName = 'div') {
    const listeners = {};
    const classSet = new Set();
    const element = {
        tagName: tagName.toUpperCase(),
        children: [],
        parentNode: null,
        style: {},
        dataset: {},
        attributes: {},
        listeners,
        _textContent: '',
        get textContent() {
            return this._textContent;
        },
        set textContent(value) {
            this._textContent = String(value);
            if (String(value) === '') {
                this.children = [];
            }
        },
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            if (child && typeof child === 'object') {
                child.style.offsetTop = String((this.children.length - 1) * 100);
            }
            return child;
        },
        insertBefore(child, reference) {
            child.parentNode = this;
            const index = this.children.indexOf(reference);
            if (index === -1) {
                this.children.push(child);
            } else {
                this.children.splice(index, 0, child);
            }
            this.children.forEach((grandChild, idx) => {
                grandChild.style.offsetTop = String(idx * 100);
            });
            return child;
        },
        replaceChildren(...children) {
            this.children = [];
            for (const child of children) {
                child.parentNode = this;
                this.children.push(child);
            }
        },
        remove() {
            if (this.parentNode) {
                this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
            }
            this.parentNode = null;
        },
        addEventListener(type, handler) {
            listeners[type] = handler;
        },
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        toggleAttribute(name, force) {
            const enabled = force === undefined ? !this.attributes[name] : force;
            this.attributes[name] = enabled;
        },
        get isConnected() {
            return this.parentNode !== null;
        }
    };

    Object.defineProperty(element, 'className', {
        get() {
            return Array.from(classSet).join(' ');
        },
        set(value) {
            classSet.clear();
            for (const token of String(value).split(/\s+/).filter(Boolean)) {
                classSet.add(token);
            }
        }
    });

    element.classList = {
        add(...values) {
            values.forEach((value) => classSet.add(value));
        },
        remove(...values) {
            values.forEach((value) => classSet.delete(value));
        },
        contains(value) {
            return classSet.has(value);
        }
    };

    Object.defineProperty(element, 'offsetHeight', {
        get() {
            const height = Number.parseInt(this.style.height, 10);
            return Number.isFinite(height) ? height : 72;
        }
    });

    Object.defineProperty(element, 'offsetTop', {
        get() {
            return Number(this.style.offsetTop || 0);
        },
        set(value) {
            this.style.offsetTop = String(value);
        }
    });

    element.style.setProperty = (name, value) => {
        element.style[name] = value;
    };

    return element;
}

test('DummyCalendarProvider returns dummy calendars and filtered events', async () => {
    const { DummyCalendarProvider } = await loadModule('src/ui/year-view/dummy-calendar-provider.js');
    const provider = new DummyCalendarProvider();

    const calendars = await provider.fetchCalendars();
    assert.equal(calendars.length, 4);
    assert.deepEqual(calendars.map((calendar) => calendar.id), ['dummy-work', 'dummy-personal', 'dummy-project', 'dummy-holidays']);

    const events = await provider.fetchCalendarEvents(2026, {
        calendarIds: ['dummy-work'],
        allDayOnly: true
    });

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.calendarId === 'dummy-work'));
    assert.ok(events.every((event) => event.allDay === true));
});

test('setupGoogleStandaloneAuth hides the mount without a usable provider and handles sign-in flow', async (t) => {
    globalThis.document = {
        createElement: (tagName) => createFakeElement(tagName)
    };
    t.after(() => {
        delete globalThis.document;
    });

    const { setupGoogleStandaloneAuth } = await loadModule('src/ui/year-view/google-standalone-auth.js');

    const mount = createFakeElement('div');
    const auth = setupGoogleStandaloneAuth({ mount, getProvider: () => null, refreshCalendars: async () => {} });
    assert.equal(mount.attributes.hidden, true);
    assert.deepEqual(mount.children, []);
    assert.equal(typeof auth.update, 'function');

    let authenticated = false;
    const provider = {
        clientId: null,
        setClientId(value) {
            this.clientId = value;
        },
        getAuthState() {
            return { configured: true, authenticated };
        },
        async signIn() {
            authenticated = true;
        },
        async signOut() {
            authenticated = false;
        }
    };

    const mountWithProvider = createFakeElement('div');
    let refreshes = 0;
    const authWithProvider = setupGoogleStandaloneAuth({
        mount: mountWithProvider,
        getProvider: () => provider,
        refreshCalendars: async () => {
            refreshes += 1;
        }
    });

    const button = mountWithProvider.children[0];
    assert.equal(button.textContent, 'Connect to Google');
    assert.equal(provider.clientId, '1025898300318-43f0pu897p8tbeu2uc2f97e867vo061q.apps.googleusercontent.com');

    await button.listeners.click();
    assert.equal(refreshes, 1);
    assert.equal(button.textContent, 'Log out');
    assert.equal(mountWithProvider.children[1].textContent, 'Connected to Google Calendar.');

    await button.listeners.click();
    assert.equal(button.textContent, 'Connect to Google');
    assert.equal(authWithProvider.update(), undefined);
});

test('GridView renders rows and reports the centered year', async (t) => {
    globalThis.document = {
        createElement: (tagName) => createFakeElement(tagName)
    };
    globalThis.window = {
        addEventListener() {}
    };
    globalThis.requestAnimationFrame = (callback) => {
        callback();
        return 0;
    };
    t.after(() => {
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.requestAnimationFrame;
    });

    const { GridView } = await loadModule('src/ui/year-view/grid-view.js');

    const viewport = createFakeElement('div');
    viewport.clientHeight = 300;
    viewport.scrollHeight = 3000;
    viewport.scrollTop = 0;
    viewport.addEventListener = (type, handler) => {
        viewport.listeners[type] = handler;
    };

    const header = createFakeElement('div');
    const rowsContainer = createFakeElement('div');
    const eventStore = {
        async getFilteredEvents() {
            return {
                events: [{
                    title: 'Demo event',
                    start: new Date(2026, 0, 1),
                    end: new Date(2026, 0, 2),
                    calendarName: 'Test',
                    calendarColor: '#123456'
                }]
            };
        }
    };

    const reportedYears = [];
    const view = new GridView({
        viewport,
        header,
        rowsContainer,
        eventStore,
        getOptions: () => ({
            showWeekNumbers: false,
            grayPastDays: false,
            highlightCurrentDay: false,
            filters: {
                calendarIds: ['dummy-work'],
                allDayOnly: false,
                calendarAllDayModes: {},
                getMinDurationMs: () => 0
            }
        }),
        onYearChange: (year) => reportedYears.push(year)
    });

    view.setMode('linear', { anchorYear: 2026 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(view.rows.length > 0);
    assert.ok(rowsContainer.children.length > 0);
    assert.equal(rowsContainer.children[0].children[0].className, 'cell month');
    assert.equal(header.className.includes('linear'), true);
    assert.ok(reportedYears.length > 0);
});
