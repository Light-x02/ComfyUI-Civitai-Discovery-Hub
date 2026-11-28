import assert from "node:assert/strict";
import test from "node:test";
import { previewImages } from "../js/gallery-preview-cache.js";

const photo = "https://image.civitai.com/gallery/portrait.png";
const namespace = "civitai-discovery-hub:previews:v1:";
function raster(policy = "public, max-age=3600", size = 16) {
    return new Response(new Uint8Array(size), { headers: { "Content-Type": "image/png", "Cache-Control": policy } });
}

function platform() {
    const buckets = new Map(), pending = new Map(), local = new Map(), live = new Set();
    let serial = 0;
    const win = {
        caches: {
            async open(name) {
                if (!buckets.has(name)) buckets.set(name, new Map());
                const data = buckets.get(name);
                return { keys: async () => [...data.keys()].map(url => ({ url })),
                    put: async (url, value) => data.set(url, value.clone()), delete: async key => data.delete(key.url) };
            },
            async match(url, { cacheName }) { return buckets.get(cacheName)?.get(url)?.clone(); },
            has: async name => buckets.has(name),
            delete: async name => buckets.delete(name),
        },
        navigator: { locks: { request(name, fn) {
            const task = (pending.get(name) || Promise.resolve()).then(fn);
            pending.set(name, task.catch(() => {}));
            return task;
        } } },
        localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
        crypto: { randomUUID: () => String(++serial) },
        URL: { createObjectURL() { const url = "blob:test-" + (++serial); live.add(url); return url; },
            revokeObjectURL(url) { assert.ok(live.delete(url)); } },
    };
    return { win, buckets, live };
}

class Target extends EventTarget {
    constructor(tag = "IMG") { super(); this.tagName = tag; }
    setAttribute(key, value) { this[key] = value; this.dispatchEvent(new Event("assigned")); }
    removeAttribute(key) { delete this[key]; }
    shown() { return new Promise(resolve => this.addEventListener("assigned", resolve, { once: true })); }
}

async function show(manager, url, el = new Target()) {
    const loaded = el.shown();
    manager.show(el, url);
    await loaded;
    return el;
}

test("clear removes just this profile’s previews and leaves visible images and other browser caches intact", async () => {
    const { win, buckets, live } = platform(), calls = [];
    win.fetch = async (url, options) => { calls.push({ url, options }); return raster(); };
    const a = previewImages(win, assert.fail, "alice"), b = previewImages(win, assert.fail, "bob");
    const unrelated = await win.caches.open("other-extension");
    await unrelated.put(photo, raster());
    const image = await show(a, photo);
    const poster = new Target("VIDEO");
    a.show(poster, photo, "poster");
    assert.equal(poster.poster, image.src);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.cache, "no-store");
    assert.equal(calls[0].options.credentials, "omit");
    a.release(poster);
    assert.ok(live.has(image.src));
    b.release(await show(b, photo));
    const sameProfile = previewImages(win, assert.fail, "alice");
    sameProfile.release(await show(sameProfile, photo));
    assert.equal(calls.length, 2);
    assert.equal(await sameProfile.clear(), 1);
    assert.ok(!buckets.has(namespace + "alice"));
    assert.equal(buckets.get(namespace + "bob").size, 1);
    assert.equal(buckets.get("other-extension").size, 1);
    assert.ok(live.has(image.src));
    a.release(image);
    assert.equal(live.size, 0);
    const fetchedAgain = await show(a, photo);
    assert.equal(calls.length, 3);
    await a.clear();
    assert.equal(await a.clear(), 0);
    a.release(fetchedAgain);
});

test("an in-flight preview from another open tab cannot repopulate a cleared cache", async () => {
    const { win, buckets } = platform();
    const started = Promise.withResolvers(), response = Promise.withResolvers();
    win.fetch = async () => { started.resolve(); return response.promise; };
    const gallery = previewImages(win, assert.fail, "shared"), storage = previewImages(win, assert.fail, "shared");
    const late = show(gallery, photo);
    await started.promise;
    assert.equal(await storage.clear(), 0);
    response.resolve(raster());
    const image = await late;
    await win.navigator.locks.request(namespace + "shared", () => {});
    assert.ok(!buckets.has(namespace + "shared"));
    gallery.release(image);
});

test("signed, private, stale and large previews remain displayable without being stored", async () => {
    const { win, buckets } = platform();
    const gallery = previewImages(win, assert.fail, "work");
    for (const [response, suffix] of [[raster(), "?signature=sample"], [raster("private, max-age=999"), ""],
        [raster("no-store, max-age=60"), ""], [raster("public, max-age=0"), ""], [raster(""), ""],
        [raster("public, max-age=3600", 512 * 1024 + 1), ""]]) {
        win.fetch = async () => response;
        gallery.release(await show(gallery, photo + suffix));
    }
    assert.equal(await gallery.clear(), 0);
    assert.equal(buckets.size, 0);
});

test("previews that remount after a clear stay out of the cache while managing storage", async () => {
    const { win, buckets } = platform();
    let save = true;
    win.fetch = async () => raster();
    const gallery = previewImages(win, assert.fail, "alice", () => save);
    const original = await show(gallery, photo);
    await win.navigator.locks.request(namespace + "alice", () => {});
    save = false;
    assert.equal(await gallery.clear(), 1);
    gallery.release(original);
    gallery.release(await show(gallery, photo));
    await win.navigator.locks.request(namespace + "alice", () => {});
    assert.equal(buckets.size, 0);
    save = true;
    const next = await show(gallery, photo + "/next");
    assert.equal(await gallery.clear(), 1);
    gallery.release(next);
});

test("up to 128 eligible previews are kept and expired entries are fetched again", async () => {
    const { win, buckets } = platform();
    let reads = 0;
    win.fetch = async () => { ++reads; return raster(); };
    const gallery = previewImages(win, assert.fail, "bounded");
    for (let i = 0; i < 129; i++) {
        const el = await show(gallery, photo + i);
        await win.navigator.locks.request(namespace + "bounded", () => {});
        gallery.release(el);
    }
    const cached = buckets.get(namespace + "bounded");
    assert.equal(cached.size, 128);
    assert.ok(!cached.has(photo + "0"));
    assert.ok(cached.has(photo + "1"));
    cached.get(photo + "1").headers.set("X-Hub-Expires", "1");
    const changed = await show(gallery, photo + "1");
    assert.equal(reads, 130);
    assert.equal(await gallery.clear(), 128);
    gallery.release(changed);
});

test("blocked cross-origin reads use the local image route and respect the original cache policy", async () => {
    const { win } = platform(), calls = [];
    let policy = "private, no-store", direct = 0;
    win.fetch = async () => { ++direct; throw new TypeError("CORS"); };
    const gallery = previewImages(win, async (url, options) => {
        calls.push({ url, options });
        return new Response(new Uint8Array(4), { headers: { "Content-Type": "image/webp",
            "Cache-Control": "no-store", "X-Civitai-Cache-Control": policy } });
    });
    gallery.release(await show(gallery, photo));
    assert.equal(await gallery.clear(), 0);
    policy = "public, max-age=300";
    const second = await show(gallery, photo);
    assert.equal(await gallery.clear(), 1);
    assert.equal(direct, 1);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.url, "/civitai_gallery/preview");
        assert.equal(call.options.cache, "no-store");
        assert.equal(call.options.method, "POST");
        assert.deepEqual(JSON.parse(call.options.body), { url: photo });
    }
    gallery.release(second);
});

test("unmounting the last viewer aborts pending loads, including when persistent storage is unavailable", async () => {
    const { win, live } = platform();
    delete win.caches;
    let signal;
    const pending = Promise.withResolvers();
    win.fetch = async (_, options) => { signal = options.signal; return pending.promise; };
    const gallery = previewImages(win, assert.fail);
    const image = new Target();
    gallery.show(image, photo);
    gallery.release(image);
    assert.ok(signal.aborted);
    pending.resolve(raster());
    await new Promise(setImmediate);
    assert.equal(image.src, undefined);
    assert.equal(live.size, 0);
    assert.equal(await gallery.clear(), null);
});
