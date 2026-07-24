import http from "node:http";
import { createProviderRegistry } from "../../../packages/provider-adapters/src/index.mjs";

const registry = createProviderRegistry({ browserApi: null, useDummyData: false });

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    if (req.url === "/api/providers") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ providers: registry.listProviders() }));
        return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
});

const port = Number(process.env.PORT || 8787);
server.listen(port, () => {
    console.log(`[backend] listening on ${port}`);
});
