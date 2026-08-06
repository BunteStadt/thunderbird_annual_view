export type PublicEnvironment = {
    supabaseUrl: string;
    supabasePublishableKey: string;
};

export function getPublicEnvironment(): PublicEnvironment | null {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
    const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

    if (!supabaseUrl || !supabasePublishableKey) {
        return null;
    }

    try {
        const parsedUrl = new URL(supabaseUrl);
        if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
            return null;
        }
    } catch {
        return null;
    }

    return { supabaseUrl, supabasePublishableKey };
}