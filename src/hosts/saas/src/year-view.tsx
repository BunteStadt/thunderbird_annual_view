import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AnnualView } from "../../../core/ui/annual-view";
import { registerProviderFactory, setCalendarProvider } from "../../../core/providers/calendar-service.js";
import { setStorageAdapter } from "../../../core/storage-port.js";
import { createWebHostStorageAdapter } from "../../web/web-storage-adapter.js";
import { createSaasGoogleProvider } from "./saas-google-provider";

export function YearView({ session }: { session: Session }) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const provider = createSaasGoogleProvider(session);
        setStorageAdapter(createWebHostStorageAdapter());
        registerProviderFactory("saas-google", () => provider);
        setCalendarProvider(provider);
        setReady(true);
    }, [session]);

    return (
        <main className="year-view-page">
            {ready && <AnnualView config={{ uiModules: [] }} />}
        </main>
    );
}