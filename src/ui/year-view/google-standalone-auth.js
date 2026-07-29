import { GOOGLE_OAUTH_CLIENT_ID } from "./google-client-id.js";

function getGoogleProvider(getProvider) {
    const provider = getProvider?.();
    const hasGoogleAuthMethods = typeof provider?.setClientId === "function"
        && typeof provider?.getAuthState === "function"
        && typeof provider?.signIn === "function"
        && typeof provider?.signOut === "function";
    return hasGoogleAuthMethods ? provider : null;
}

export function setupGoogleStandaloneAuth({ mount, getProvider, refreshCalendars }) {
    if (!mount) {
        return { update: () => { } };
    }

    const provider = getGoogleProvider(getProvider);
    if (!provider) {
        mount.toggleAttribute("hidden", true);
        mount.replaceChildren();
        return { update: () => { } };
    }

    mount.toggleAttribute("hidden", false);
    mount.style.display = "inline-flex";
    mount.style.alignItems = "center";
    mount.style.gap = "0.65rem";
    mount.style.flexWrap = "wrap";

    const connectButton = document.createElement("button");
    connectButton.className = "btn";
    connectButton.dataset.size = "compact";
    connectButton.type = "button";

    const status = document.createElement("span");
    status.style.fontSize = "0.82rem";
    status.style.color = "var(--muted)";
    status.setAttribute("aria-live", "polite");

    mount.replaceChildren(connectButton, status);

    provider.setClientId(GOOGLE_OAUTH_CLIENT_ID);
    let authError = "";

    const update = () => {
        const { configured, authenticated } = provider.getAuthState();
        connectButton.textContent = authenticated ? "Log out" : "Connect to Google";
        connectButton.disabled = !configured;
        status.textContent = authError
            || (!configured
                ? "Set your Google OAuth client ID in src/ui/year-view/google-client-id.js."
                : (authenticated ? "Connected to Google Calendar." : "Not connected to Google Calendar."));
    };

    connectButton.addEventListener("click", async () => {
        authError = "";
        const { configured, authenticated } = provider.getAuthState();
        if (!configured) {
            update();
            return;
        }

        try {
            if (authenticated) {
                await provider.signOut();
            } else {
                await provider.signIn();
            }
            await refreshCalendars?.();
        } catch (err) {
            authError = err?.message || (authenticated ? "Google sign-out failed." : "Google sign-in failed.");
            console.error(authenticated ? "[google-auth] sign-out failed" : "[google-auth] sign-in failed", err);
        }

        update();
    });

    update();
    return { update };
}
