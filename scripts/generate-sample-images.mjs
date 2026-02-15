import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "local";
const outputDir = path.join(repoRoot, "media", "generated", releaseTag);
const yearViewUrl = process.env.YEAR_VIEW_URL || pathToFileURL(path.join(repoRoot, "src", "ui", "year-view", "year-view.html")).href;

const baseScenarios = [
    { mode: "linear", theme: "light" },
    { mode: "day-aligned", theme: "light" },
    { mode: "week-rows", theme: "light" },
    { mode: "linear", theme: "dark" },
    { mode: "day-aligned", theme: "dark" },
    { mode: "week-rows", theme: "dark" }
];

const optionScenarios = [
    {
        mode: "linear",
        theme: "light",
        suffix: "options-enabled",
        options: { allDayOnly: true, showWeekNumbers: false, grayPastDays: true, highlightCurrentDay: true, minDurationHours: 1 }
    },
    {
        mode: "day-aligned",
        theme: "dark",
        suffix: "options-disabled",
        options: { allDayOnly: false, showWeekNumbers: false, grayPastDays: false, highlightCurrentDay: false, minDurationHours: 25 }
    }
];

function makeStoragePreset({ mode, theme, options = {} }) {
    return {
        viewMode: mode,
        uiThemeOverride: theme,
        showWeekNumbers: options.showWeekNumbers ?? true,
        grayPastDays: options.grayPastDays ?? false,
        highlightCurrentDay: options.highlightCurrentDay ?? false
    };
}

async function applyOptions(page, options = {}) {
    const toggleButton = page.locator("#toggleCalendars");
    if (await toggleButton.count()) {
        const expanded = await toggleButton.getAttribute("aria-expanded");
        if (expanded !== "true") {
            await toggleButton.click();
        }
    }

    const setCheckedIfNeeded = async (selector, expected) => {
        if (typeof expected !== "boolean") return;
        await page.evaluate(({ targetSelector, targetValue }) => {
            const input = document.querySelector(targetSelector);
            if (!input || !("checked" in input)) return;
            const next = Boolean(targetValue);
            if (input.checked === next) return;
            input.checked = next;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }, { targetSelector: selector, targetValue: expected });
    };

    await setCheckedIfNeeded("#allDayOnly", options.allDayOnly);

    if (typeof options.minDurationHours === "number") {
        await page.fill("#minDurationHours", String(options.minDurationHours));
        await page.dispatchEvent("#minDurationHours", "change");
    }
}

async function captureScenario(browser, scenario) {
    const context = await browser.newContext({
        viewport: { width: 2100, height: 1500 },
        colorScheme: scenario.theme === "dark" ? "dark" : "light"
    });

    await context.addInitScript(({ storageState }) => {
        const state = { ...storageState };
        globalThis.browser = {
            storage: {
                local: {
                    async get(keys) {
                        if (typeof keys === "string") {
                            return Object.prototype.hasOwnProperty.call(state, keys) ? { [keys]: state[keys] } : {};
                        }
                        if (Array.isArray(keys)) {
                            return keys.reduce((acc, key) => {
                                if (Object.prototype.hasOwnProperty.call(state, key)) acc[key] = state[key];
                                return acc;
                            }, {});
                        }
                        if (keys && typeof keys === "object") {
                            return Object.entries(keys).reduce((acc, [key, defaultValue]) => {
                                acc[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : defaultValue;
                                return acc;
                            }, {});
                        }
                        return { ...state };
                    },
                    async set(value) {
                        Object.assign(state, value || {});
                    }
                }
            }
        };
    }, { storageState: makeStoragePreset(scenario) });

    const page = await context.newPage();
    await page.goto(yearViewUrl);
    await page.waitForFunction(() => {
        const grid = document.getElementById("calendarGrid");
        return !!grid && grid.children.length > 0;
    });
    await applyOptions(page, scenario.options);

    await page.waitForFunction(() => {
        const layer = document.getElementById("eventsLayer");
        return !!layer && layer.childElementCount > 0;
    });

    const fileName = `${scenario.suffix}.png`;
    const filePath = path.join(outputDir, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    await context.close();
}

async function main() {
    await fs.mkdir(outputDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
        const scenarios = [...baseScenarios.map((scenario) => ({ ...scenario, suffix: `${scenario.mode}-${scenario.theme}` })), ...optionScenarios];
        for (const scenario of scenarios) {
            console.log(`[screenshots] Capturing ${scenario.suffix}`);
            await captureScenario(browser, scenario);
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error("[screenshots] Failed to generate sample images", error);
    process.exitCode = 1;
});
