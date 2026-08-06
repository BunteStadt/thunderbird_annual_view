import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import shellHtml from "../../../core/ui/index.html?raw";
import yearViewCss from "../../../core/ui/year-view.css?inline";
import { initApp } from "../../../core/app.js";
import { registerProviderFactory, setCalendarProvider } from "../../../core/providers/calendar-service.js";
import { setStorageAdapter } from "../../../core/storage-port.js";
import { createWebHostStorageAdapter } from "../../web/web-storage-adapter.js";
import { createSaasGoogleProvider } from "./saas-google-provider";

type AppApi = { destroy?: () => void };

function shellBody(): string {
    const parsed = new DOMParser().parseFromString(shellHtml, "text/html");
    parsed.querySelector("noscript")?.remove();
    return parsed.body.innerHTML;
}

export function YearView({ session }: { session: Session }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = yearViewCss
            .replace(":root {", ":host {")
            .replace("body {", ".annual-view-body {");
        const shell = document.createElement("div");
        shell.className = "annual-view-body theme-dark";
        shell.innerHTML = shellBody();
        shadow.replaceChildren(style, shell);

        const provider = createSaasGoogleProvider(session);
        setStorageAdapter(createWebHostStorageAdapter());
        registerProviderFactory("saas-google", () => provider);
        setCalendarProvider(provider);

        let disposed = false;
        let app: AppApi | null = null;
        void initApp({ root: shell, themeRoot: shell }).then((api: AppApi) => {
            if (disposed) api.destroy?.();
            else app = api;
        }).catch((reason: unknown) => {
            if (!disposed) setError(reason instanceof Error ? reason.message : "Annual View could not start.");
        });

        return () => {
            disposed = true;
            app?.destroy?.();
            shadow.replaceChildren();
        };
    }, [session]);

    return (
        <main className="year-view-page">
            {error && <p className="app-error" role="alert">{error}</p>}
            <div className="year-view-host" ref={hostRef} />
        </main>
    );
}