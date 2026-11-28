// Live elements share an object URL. Only small, cacheable responses are kept after release.
const CACHE_ENTRIES = 128, CACHE_ITEM_BYTES = 512 * 1024;
const IMAGE_BYTES = 64 * 1024 * 1024;

export function previewImages(win, fetchLocal, profile, canStore = () => true) {
    const name = "civitai-discovery-hub:previews:v1:" + (profile || "default");
    const generation = name + ":generation";
    const images = new WeakMap(), active = new Map(), proxyHosts = new Set();
    let storage = null, locks = null;
    try {
        if (win.caches && win.navigator.locks && win.localStorage) {
            storage = win.caches;
            locks = win.navigator.locks;
        }
    } catch { /* Private browsing can disable persistent site storage. */ }

    function epoch() {
        try { return storage && (win.localStorage.getItem(generation) || ""); }
        catch { return null; }
    }
    async function remember(url, blob, expires, started, signal) {
        if (!storage || started === null || blob.size > CACHE_ITEM_BYTES || !expires) return;
        await locks.request(name, async () => {
            if (signal.aborted || !canStore() || epoch() !== started) return;
            const cache = await storage.open(name);
            const keys = await cache.keys();
            if (keys.length >= CACHE_ENTRIES && !keys.some(key => key.url === url)) {
                for (const key of keys.slice(0, keys.length - CACHE_ENTRIES + 1)) await cache.delete(key);
            }
            await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type, "X-Hub-Expires": String(expires) } }));
        });
    }
    async function readImage(source, signal) {
        const url = new URL(source), started = canStore() ? epoch() : null;
        if (storage && !url.search) {
            const hit = await storage.match(source, { cacheName: name }).catch(() => null);
            if (hit && Number(hit.headers.get("X-Hub-Expires")) > Date.now()) return hit.blob();
        }
        signal.throwIfAborted();
        let response, policy;
        if (!proxyHosts.has(url.hostname)) {
            try {
                response = await win.fetch(source, { signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
                policy = response.headers.get("Cache-Control");
                if (response.url && new URL(response.url).search) policy = "no-store";
            } catch (error) {
                if (signal.aborted || error.name !== "TypeError") throw error;
            }
        }
        if (!response) {
            response = await fetchLocal("/civitai_gallery/preview", { method: "POST", cache: "no-store", signal,
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source }) });
            if (response.ok) proxyHosts.add(url.hostname);
            policy = response.headers.get("X-Civitai-Cache-Control");
        }
        if (!response.ok) throw new Error("Preview HTTP " + response.status);
        if (Number(response.headers.get("Content-Length")) > IMAGE_BYTES) {
            await response.body?.cancel();
            throw new Error("Preview exceeds 64 MiB.");
        }
        const type = (response.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
        if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/jxl",
            "application/octet-stream", "binary/octet-stream"].includes(type)) {
            await response.body?.cancel();
            throw new Error("Unsupported preview type.");
        }
        const reader = response.body.getReader();
        const parts = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > IMAGE_BYTES) {
                await reader.cancel();
                throw new Error("Preview exceeds 64 MiB.");
            }
            parts.push(value);
        }
        const blob = new Blob(parts, { type });
        if (!url.search && !/\b(no-store|no-cache|private)\b/i.test(policy || "")) {
            const maxAge = Number(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(policy || "")?.[1] || 0);
            const seconds = Math.max(0, Math.min(86400, maxAge - Number(response.headers.get("Age") || 0)));
            if (seconds) void remember(source, blob, Date.now() + seconds * 1000, started, signal).catch(() => {});
        }
        return blob;
    }
    function release(element) {
        const entry = images.get(element);
        if (!entry) return;
        element.removeAttribute(entry.users.get(element));
        entry.users.delete(element);
        images.delete(element);
        if (entry.users.size) return;
        entry.controller.abort();
        if (entry.objectUrl) win.URL.revokeObjectURL(entry.objectUrl);
        active.delete(entry.source);
    }
    function show(element, source, attribute = "src") {
        if (images.get(element)?.source === source) return;
        release(element);
        if (!source) return;
        let entry = active.get(source);
        if (!entry) {
            entry = { source, controller: new AbortController(), users: new Map(), objectUrl: "" };
            active.set(source, entry);
            const { signal } = entry.controller;
            readImage(source, signal).then(blob => {
                if (signal.aborted) return;
                entry.objectUrl = win.URL.createObjectURL(blob);
                for (const [target, attr] of entry.users) target.setAttribute(attr, entry.objectUrl);
            }).catch(() => {
                if (signal.aborted) return;
                for (const target of [...entry.users.keys()]) {
                    release(target);
                    if (target.tagName === "IMG") target.dispatchEvent(new Event("error"));
                }
            });
        }
        entry.users.set(element, attribute);
        images.set(element, entry);
        if (entry.objectUrl) element.setAttribute(attribute, entry.objectUrl);
    }
    return {
        show, release, source: element => images.get(element)?.source || "",
        async clear() {
            if (!storage) return null;
            return locks.request(name, async () => {
                let count = 0;
                if (await storage.has(name)) {
                    const cache = await storage.open(name);
                    count = (await cache.keys()).length;
                    await storage.delete(name);
                }
                // Requests started before or during deletion must not write the same previews back.
                win.localStorage.setItem(generation, win.crypto.randomUUID());
                return count;
            });
        },
    };
}
