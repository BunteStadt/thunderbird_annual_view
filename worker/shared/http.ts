export function json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "no-store");
    return Response.json(data, { ...init, headers });
}

export function methodNotAllowed(allowed: string): Response {
    return json({ error: "Method not allowed" }, {
        status: 405,
        headers: { Allow: allowed }
    });
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function applicationUrl(env: Env, path: string): string {
    const base = new URL(env.APP_URL);
    if (base.protocol !== "https:" && base.hostname !== "localhost") {
        throw new Error("APP_URL must use HTTPS outside local development.");
    }
    return new URL(path, base).toString();
}