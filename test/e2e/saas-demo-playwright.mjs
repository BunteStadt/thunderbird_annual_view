import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "playwright";

const host = "127.0.0.1";
const port = 4174;
const baseUrl = `http://${host}:${port}`;

function waitForServer(server) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 30_000;
        const check = async () => {
            try {
                const response = await fetch(`${baseUrl}/demo`);
                if (response.ok) {
                    resolve();
                    return;
                }
            } catch {
                // Vite is still starting.
            }
            if (Date.now() >= deadline) {
                reject(new Error("SaaS dev server did not start within 30 seconds."));
                return;
            }
            setTimeout(check, 250);
        };
        server.once("exit", (code) => reject(new Error(`SaaS dev server exited with code ${code}.`)));
        void check();
    });
}

async function main() {
    const server = spawn(process.execPath, [
        "node_modules/vite/bin/vite.js",
        "--host",
        host,
        "--port",
        String(port)
    ], {
        stdio: "ignore",
        env: { ...process.env, VITE_CLERK_PUBLISHABLE_KEY: "" }
    });

    let browser;
    try {
        await waitForServer(server);
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const consoleErrors = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(error.message));

        await page.goto(`${baseUrl}/demo?embed=1`, { waitUntil: "networkidle" });
        await page.locator("#gridRows .event").first().waitFor({ state: "visible" });

        const eventCount = await page.locator("#gridRows .event").count();
        if (eventCount === 0) throw new Error("Demo rendered no calendar events.");
        if (await page.locator("#calendarList .calendar-row").count() !== 4) {
            throw new Error("Demo did not render all four demo calendars.");
        }

        await page.locator("#yearInput").fill("2027");
        await page.locator("#yearInput").press("Enter");
        if (await page.locator("#yearInput").inputValue() !== "2027") {
            throw new Error("Year navigation did not update the selected year.");
        }

        await page.locator("#viewMode").selectOption("two-week-rows");
        if (await page.locator("#viewMode").inputValue() !== "two-week-rows") {
            throw new Error("View mode control did not update.");
        }

        await page.locator("#themeToggle").click();
        await page.locator("#toggleCalendars").click();
        if (await page.locator("#calendarFilters").isVisible()) {
            throw new Error("Calendar options did not collapse.");
        }

        if (consoleErrors.length > 0) {
            throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
        }

        console.log(`SaaS demo Playwright smoke test passed (${eventCount} initial events).`);
    } finally {
        await browser?.close();
        server.kill("SIGTERM");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});