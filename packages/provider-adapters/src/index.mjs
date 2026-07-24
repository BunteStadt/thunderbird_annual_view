import { createThunderbirdProvider } from "./thunderbird.mjs";

export function createProviderRegistry({ browserApi = globalThis.browser, useDummyData = false } = {}) {
    const thunderbird = createThunderbirdProvider({ browserApi, useDummyData });
    return {
        listProviders() {
            return [{ id: thunderbird.id, name: "Thunderbird" }];
        },
        getProvider(id) {
            if (id === thunderbird.id) return thunderbird;
            return null;
        }
    };
}

export { createThunderbirdProvider };
