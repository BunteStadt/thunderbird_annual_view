import { CalendarProvider, resolveCalendarAllDayOnly } from "./calendar-provider.js";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_GSI_SCRIPT = "https://accounts.google.com/gsi/client";
const TOKEN_EXPIRY_SKEW_MS = 5000;
// Fallback duration when Google returns an event without a valid end timestamp.
const FALLBACK_EVENT_LENGTH_MS = 60 * 60 * 1000;

function parseGoogleDate(value, allDay) {
    if (!value) return null;
    if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizeClientId(value) {
    return String(value || "").trim();
}

export class GoogleAuthSession {
    constructor() {
        this._clientId = "";
        this._accessToken = "";
        this._expiresAt = 0;
        this._gsiLoadPromise = null;
        this._tokenClient = null;
    }

    setClientId(clientId) {
        const nextClientId = sanitizeClientId(clientId);
        if (nextClientId === this._clientId) return;
        this._clientId = nextClientId;
        this._tokenClient = null;
        this._accessToken = "";
        this._expiresAt = 0;
    }

    getClientId() {
        return this._clientId;
    }

    isConfigured() {
        return this._clientId.length > 0;
    }

    isAuthenticated() {
        return !!this._accessToken && Date.now() + TOKEN_EXPIRY_SKEW_MS < this._expiresAt;
    }

    _setToken(tokenResponse = {}) {
        const accessToken = tokenResponse.access_token || "";
        if (!accessToken) {
            this._accessToken = "";
            this._expiresAt = 0;
            return;
        }
        const expiresInSeconds = Number(tokenResponse.expires_in) || 3600;
        this._accessToken = accessToken;
        this._expiresAt = Date.now() + expiresInSeconds * 1000;
    }

    async _ensureGsiLoaded() {
        if (globalThis.google?.accounts?.oauth2?.initTokenClient) return;

        if (!this._gsiLoadPromise) {
            this._gsiLoadPromise = new Promise((resolve, reject) => {
                if (!globalThis.document?.createElement || !globalThis.document?.head) {
                    reject(new Error("Google Sign-In requires a browser document context."));
                    return;
                }
                const existing = globalThis.document.querySelector(`script[src="${GOOGLE_GSI_SCRIPT}"]`);
                if (existing) {
                    if (globalThis.google?.accounts?.oauth2?.initTokenClient) {
                        resolve();
                        return;
                    }
                    existing.addEventListener("load", () => resolve(), { once: true });
                    existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In script.")), { once: true });
                    return;
                }
                const script = globalThis.document.createElement("script");
                script.src = GOOGLE_GSI_SCRIPT;
                script.async = true;
                script.defer = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error("Failed to load Google Sign-In script."));
                globalThis.document.head.appendChild(script);
            });
        }

        await this._gsiLoadPromise;
    }

    async _ensureTokenClient() {
        if (!this.isConfigured()) {
            throw new Error("Google OAuth client ID is missing.");
        }
        await this._ensureGsiLoaded();
        if (this._tokenClient) return this._tokenClient;

        this._tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
            client_id: this._clientId,
            scope: GOOGLE_SCOPE,
            callback: () => { }
        });
        return this._tokenClient;
    }

    async signIn() {
        return this._requestAccessToken({ prompt: this.isAuthenticated() ? "" : "consent" });
    }

    async _requestAccessToken(options = {}) {
        const tokenClient = await this._ensureTokenClient();
        const { prompt = "" } = options;
        return new Promise((resolve, reject) => {
            tokenClient.callback = (response) => {
                if (response?.error) {
                    reject(new Error(response.error_description || response.error));
                    return;
                }
                this._setToken(response);
                resolve({ authenticated: this.isAuthenticated() });
            };
            tokenClient.requestAccessToken({ prompt });
        });
    }

    async _signInWithConsent() {
        return this._requestAccessToken({ prompt: "consent" });
    }

    async signOut() {
        if (!this._accessToken) return;
        const token = this._accessToken;
        this._accessToken = "";
        this._expiresAt = 0;
        if (globalThis.google?.accounts?.oauth2?.revoke) {
            await new Promise((resolve) => {
                globalThis.google.accounts.oauth2.revoke(token, () => resolve());
            });
        }
    }

    getAuthState() {
        return {
            configured: this.isConfigured(),
            authenticated: this.isAuthenticated(),
            clientId: this._clientId
        };
    }

    async authorizedFetch(url) {
        if (!this.isAuthenticated()) {
            throw new Error("Not authenticated with Google Calendar.");
        }
        let response = await fetch(url, {
            headers: {
                Authorization: "Bearer " + this._accessToken
            }
        });

        if (response.status === 403) {
            const parsed403 = await parseGoogleErrorPayload(response);
            if (isScopeOrPermissionError(parsed403)) {
                this._accessToken = "";
                this._expiresAt = 0;
                await this._signInWithConsent();
                response = await fetch(url, {
                    headers: {
                        Authorization: "Bearer " + this._accessToken
                    }
                });
            }
        }

        const parsedError = response.ok ? null : await parseGoogleErrorPayload(response);
        if (response.status === 401 || response.status === 403) {
            this._accessToken = "";
            this._expiresAt = 0;
        }
        if (!response.ok) {
            const details = formatGoogleErrorDetails(parsedError);
            throw new Error(details
                ? `Google Calendar request failed (${response.status}): ${details}`
                : `Google Calendar request failed (${response.status})`);
        }
        return response.json();
    }
}

async function parseGoogleErrorPayload(response) {
    try {
        const payload = await response.clone().json();
        return payload?.error || null;
    } catch {
        return null;
    }
}

function isScopeOrPermissionError(error) {
    const status = String(error?.status || "");
    if (status === "PERMISSION_DENIED") return true;
    const messages = [
        error?.message,
        ...(Array.isArray(error?.errors) ? error.errors.map((entry) => `${entry?.reason || ""} ${entry?.message || ""}`) : [])
    ].join(" ").toLowerCase();
    return messages.includes("scope")
        || messages.includes("permission")
        || messages.includes("insufficient");
}

function formatGoogleErrorDetails(error) {
    if (!error) return "";
    const details = [];
    if (error.message) details.push(error.message);
    if (Array.isArray(error.errors)) {
        for (const entry of error.errors) {
            const reason = String(entry?.reason || "").trim();
            const message = String(entry?.message || "").trim();
            const merged = [reason, message].filter(Boolean).join(": ");
            if (merged) details.push(merged);
        }
    }
    return Array.from(new Set(details)).join(" | ");
}

function mapCalendar(calendar) {
    return {
        id: calendar.id,
        name: calendar.summary || calendar.id || "(unnamed)",
        color: calendar.backgroundColor || calendar.foregroundColor || "#0a84ff"
    };
}

function mapEvent(item, calendar) {
    const allDay = !!item?.start?.date && !item?.start?.dateTime;
    const start = parseGoogleDate(item?.start?.dateTime || item?.start?.date, allDay);
    const parsedEnd = parseGoogleDate(item?.end?.dateTime || item?.end?.date, allDay);
    if (!start) return null;

    let end = parsedEnd;
    if (!end) {
        end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : FALLBACK_EVENT_LENGTH_MS));
    }
    if (end.getTime() <= start.getTime()) {
        end = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : FALLBACK_EVENT_LENGTH_MS));
    }

    return {
        id: item.id || `${calendar.id}-${start.getTime()}`,
        calendarId: calendar.id,
        title: item.summary || "(untitled)",
        start,
        end,
        allDay,
        description: item.description || "",
        location: item.location || "",
        calendarName: calendar.name || "(unnamed)",
        calendarColor: calendar.color || null
    };
}

export class GoogleCalendarProvider extends CalendarProvider {
    constructor(authSession = new GoogleAuthSession()) {
        super();
        this.authSession = authSession;
    }

    setClientId(clientId) {
        this.authSession.setClientId(clientId);
    }

    getAuthState() {
        return this.authSession.getAuthState();
    }

    async signIn() {
        return this.authSession.signIn();
    }

    async signOut() {
        return this.authSession.signOut();
    }

    async fetchCalendars() {
        if (!this.authSession.isAuthenticated()) {
            return [];
        }
        try {
            const result = await this.authSession.authorizedFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList");
            return (result.items || []).map(mapCalendar);
        } catch (err) {
            console.error("[GoogleCalendarProvider] fetchCalendars failed", err);
            return [];
        }
    }

    async fetchCalendarEvents(year, options = {}) {
        if (!this.authSession.isAuthenticated()) {
            return [];
        }

        const { calendarIds = [] } = options;
        const calendars = (await this.fetchCalendars()).filter((calendar) => !calendarIds.length || calendarIds.includes(calendar.id));
        if (!calendars.length) {
            return [];
        }

        const timeMin = new Date(Date.UTC(year, 0, 1, 0, 0, 0)).toISOString();
        const timeMax = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0)).toISOString();

        const perCalendarEvents = await Promise.all(calendars.map(async (calendar) => {
            const calendarEvents = [];
            let pageToken = "";
            do {
                const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
                url.searchParams.set("singleEvents", "true");
                url.searchParams.set("orderBy", "startTime");
                url.searchParams.set("timeMin", timeMin);
                url.searchParams.set("timeMax", timeMax);
                url.searchParams.set("maxResults", "2500");
                if (pageToken) {
                    url.searchParams.set("pageToken", pageToken);
                }
                const data = await this.authSession.authorizedFetch(url.toString());
                for (const item of data.items || []) {
                    const event = mapEvent(item, calendar);
                    if (!event) continue;
                    if (resolveCalendarAllDayOnly(calendar.id, options) && !event.allDay) {
                        continue;
                    }
                    calendarEvents.push(event);
                }
                pageToken = data.nextPageToken || "";
            } while (pageToken);
            return calendarEvents;
        }));

        return perCalendarEvents.flat();
    }
}
