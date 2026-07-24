import { buildCalendarSummary } from "../../../packages/core/src/index.js";

const output = document.getElementById("output");
const signInButton = document.getElementById("signInButton");

function render(message) {
    if (output) {
        output.textContent = message;
    }
}

signInButton?.addEventListener("click", () => {
    const sampleEvents = [
        { calendarId: "thunderbird", id: "1" },
        { calendarId: "google", id: "2" },
        { calendarId: "google", id: "3" }
    ];
    const summary = buildCalendarSummary(sampleEvents);
    render(`Signed in (demo). Event summary: ${JSON.stringify(summary, null, 2)}`);
});

render("Waiting for sign-in.");
