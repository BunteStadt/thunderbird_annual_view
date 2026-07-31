// Empty-state message for the web host: shown while no calendar source is
// configured (no Google connection, no uploaded ICS files, no demo data).

export function setupEmptyState({ mount, listCalendars }) {
    if (!mount) {
        return { update: () => { } };
    }

    const message = document.createElement("p");
    message.className = "empty-state-message";
    message.textContent = "Connect Google or upload an .ics file to get started.";
    mount.replaceChildren(message);

    const update = () => {
        const hasCalendars = (listCalendars?.() || []).length > 0;
        mount.toggleAttribute("hidden", hasCalendars);
    };

    update();
    return { update };
}
