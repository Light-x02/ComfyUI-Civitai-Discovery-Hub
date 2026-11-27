import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildGalleryView } from "../js/gallery-view.js";

const source = readFileSync(new URL("../js/Civitai_Discovery_Hub.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "");

function image(id) {
    return { id, type: "image", url: `https://image.civitai.com/${id}.png`, meta: { prompt: `prompt ${id}` } };
}

function page(ids, nextCursor = null) {
    return { items: ids.map(image), metadata: { aggregated: true, nextCursor } };
}

class Element extends EventTarget {
    constructor(tag = "div") {
        super();
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.controls = new Map();
        this.classes = new Set();
        this.classList = {
            add: (name) => this.classes.add(name),
            contains: (name) => this.classes.has(name),
            remove: (name) => this.classes.delete(name),
            toggle: (name, flag) => flag ? this.classes.add(name) : this.classes.delete(name),
        };
        this.dataset = {};
        this.style = { setProperty() {} };
        this.value = "";
        this.scrollTop = 0;
        this.clientHeight = 600;
        this.scrollHeight = 600;
        this.clientWidth = 1000;
    }
    get className() { return [...this.classes].join(" "); }
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    set innerHTML(html) {
        for (const [, tag, classes] of html.matchAll(/<(\w+)\b[^>]*?\sclass="([^"]+)"[^>]*>/g)) {
            const element = new Element(tag);
            element.className = classes;
            for (const name of element.classes) this.controls.set(`.${name}`, element);
        }
    }
    get options() { return this.children.flatMap((el) => el.tagName === "OPTGROUP" ? el.children : [el]); }
    querySelector(selector) {
        return this.controls.get(selector) ?? this.querySelectorAll(selector)[0] ?? null;
    }
    querySelectorAll(selector) {
        const matches = (el) => selector.startsWith(".")
            ? selector.slice(1).split(".").every((name) => el.classes.has(name))
            : el.tagName === selector.toUpperCase();
        return this.children.flatMap((el) => [...(matches(el) ? [el] : []), ...el.querySelectorAll(selector)]);
    }
    appendChild(el) { this.children.push(el); return el; }
    append(...els) { this.children.push(...els); }
    replaceChildren(...els) { this.children = els; }
    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] ?? null; }
    removeAttribute(name) { delete this[name]; }
    pause() { this.paused = true; }
    load() {}
    contains(el) { return this === el || this.children.some((child) => child.contains(el)); }
    click() { this.dispatchEvent(new Event("click")); }
}

function gallery(respond = () => page([1, 2])) {
    const requests = [];
    const frames = new Map();
    const stored = new Map();
    let frameId = 0;
    let extension;
    const app = { registerExtension(ext) { extension = ext; } };
    const api = { async fetchApi(path, { signal, body } = {}) {
        const url = new URL(path, "http://comfy.test");
        requests.push({ url, signal, body });
        const data = url.pathname.endsWith("/get_favorite_ids") ? { ids: [] } : await respond(url, signal, body);
        if (data instanceof Response) return data;
        return { ok: true, json: async () => data };
    } };
    class Observer { observe() {} unobserve() {} disconnect() {} }
    class ViewObserver extends Observer {
        constructor(callback, options) { super(); this.callback = callback; this.root = options?.root; }
        observe(target) {
            queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
        }
    }
    const document = Object.assign(new EventTarget(), {
        head: new Element("head"),
        getElementById(id) { return this.head.children.find(el => el.id === id) ?? null; },
        createElement(tag) { return new Element(tag); },
    });
    vm.runInNewContext(source, {
        app, api, URL, URLSearchParams, AbortController, EventTarget, CustomEvent, console, setTimeout, clearTimeout,
        buildGalleryView, document,
        ResizeObserver: Observer, IntersectionObserver: ViewObserver,
        requestAnimationFrame: (cb) => { frames.set(++frameId, cb); return frameId; },
        cancelAnimationFrame: (id) => frames.delete(id),
        location: { pathname: "/" },
        localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    });
    class Node {
        constructor() {
            this.id = -1;
            this.properties = {};
            this.inputs = [];
            this.outputs = [{}, {}, { links: [] }, {}];
            this.widgets = [{
                name: "selection_data", element: new Element("textarea"), options: {},
                get value() { return this.element.value; },
                // ComfyUI's native multiline DOM widget calls back on programmatic writes.
                set value(v) { this.element.value = v; this.callback?.(v); },
            }];
            this.widgets[0].value = "{}";
            this.pos = [0, 0];
        }
        addDOMWidget(name, type, root) { this.root = root; return { name, type, element: root }; }
        configure(saved) {
            Object.assign(this.properties, structuredClone(saved.properties));
            this.widgets[0].value = saved.widgets_values[0];
        }
        setDirtyCanvas() {}
        control(name) { return this.root.querySelector(`.cg-${name}`); }
        cards() { return this.control("masonry").querySelectorAll(".cg-card"); }
        async queueSelection() { return JSON.parse(await this.widgets[0].serializeValue(this, 0)); }
        save() { return { properties: structuredClone(this.properties), widgets_values: [this.widgets[0].value] }; }
    }
    extension.beforeRegisterNodeDef(Node, { name: "CivitaiDiscoveryHubNode" });
    return {
        requests, document,
        add(id, saved) {
            const node = new Node();
            node.onNodeCreated();
            node.id = id;
            node.onAdded?.();
            if (saved) node.configure(saved);
            return node;
        },
        async settle() {
            for (let i = 0; i < 5; ++i) {
                await new Promise(setImmediate);
                const ready = [...frames.values()];
                frames.clear();
                for (const cb of ready) cb();
            }
        },
    };
}

test("two gallery nodes share one stylesheet and build independent tag controls", () => {
    const ui = gallery();
    const first = ui.add(1);
    const second = ui.add(2);
    assert.equal(ui.document.head.children.length, 1);
    const link = ui.document.head.children[0];
    assert.equal(link.rel, "stylesheet");
    assert.equal(link.href, new URL("../js/gallery.css", import.meta.url).href);
    assert.ok(first.root.classList.contains("civitai-discovery-gallery"));
    assert.notEqual(first.root.id, second.root.id);
    assert.notEqual(first.control("tags"), second.control("tags"));
    assert.ok(second.control("tags").options.some(option => option.value === "5132"));
    first.onRemoved();
    second.onRemoved();
});

test("hover reserves vertical wheel input for an overflowing gallery and releases it on exit or removal", () => {
    const ui = gallery();
    const node = ui.add(1);
    const scroll = node.control("scroll");
    const wheel = (target, init = {}) => {
        const event = Object.assign(new Event("wheel", { cancelable: true }), {
            deltaX: 0, deltaY: 100, composedPath: () => [target, ui.document], ...init,
        });
        ui.document.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
        return event.cancelBubble;
    };
    scroll.scrollHeight = scroll.clientHeight + 100;
    assert.equal(wheel(scroll), false);
    scroll.dispatchEvent(new Event("pointerenter"));
    assert.equal(wheel(scroll), true);
    assert.equal(wheel(scroll, { deltaY: -100 }), true);
    assert.equal(wheel(node.control("foot")), false);
    for (const gesture of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { deltaX: 120 }]) {
        assert.equal(wheel(scroll, gesture), false);
    }
    scroll.scrollHeight = scroll.clientHeight;
    assert.equal(wheel(scroll), false);
    scroll.scrollHeight += 100;
    scroll.dispatchEvent(new Event("pointerleave"));
    assert.equal(wheel(scroll), false);
    scroll.dispatchEvent(new Event("pointerenter"));
    node.onRemoved();
    assert.equal(wheel(scroll), false);
});

test("the hidden selection survives restore and follows the current output links when queued", async () => {
    const ui = gallery();
    const first = ui.add(11);
    assert.equal(first.widgets[0].hidden, true);
    await ui.settle();
    first.cards()[0].click();
    const restored = ui.add(12, first.save());
    assert.equal(restored.widgets[0].hidden, true);
    assert.equal(first.save().properties.__cg.selection_data, undefined);
    await ui.settle();
    assert.equal((await restored.queueSelection()).item.id, 1);
    restored.cards()[1].click();
    restored.outputs[2].links = [42];
    const queued = await restored.queueSelection();
    assert.equal(queued.item.id, 2);
    assert.equal(queued.download_image, true);
    restored.outputs[2].links = [];
    assert.equal((await restored.queueSelection()).download_image, false);
    assert.equal((await first.queueSelection()).item.id, 1);
});

test("display OFF is restored before fetching and is scoped to one node", async () => {
    const ui = gallery();
    const original = ui.add(11);
    await ui.settle();
    original.control("toggle-render").click();
    await ui.settle();
    const count = ui.requests.length;
    const restored = ui.add(12, original.save());
    await ui.settle();
    assert.match(restored.control("toggle-render").textContent, /OFF/i);
    assert.equal(ui.requests.length, count);
    const independent = ui.add(13);
    await ui.settle();
    assert.match(independent.control("toggle-render").textContent, /ON/i);
    assert.ok(independent.cards().length);
    restored.control("toggle-render").click();
    await ui.settle();
    assert.ok(restored.cards().length);
});

test("older gallery workflows retain their selection and API imports work without gallery properties", async () => {
    const ui = gallery();
    const value = JSON.stringify({ item: image(39), download_image: true });
    const legacy = ui.add(1, {
        properties: { __cg: { selection_data: value, has_loaded_once: true, display_on: false } },
        widgets_values: [value],
    });
    const imported = ui.add(2);
    // loadApiJson assigns widget values on the new node without calling configure.
    imported.widgets[0].value = value;
    imported.widgets[0].callback?.(value);
    await ui.settle();
    for (const node of [legacy, imported]) {
        const selected = await node.queueSelection();
        assert.equal(selected.item.id, 39);
        assert.equal(selected.download_image, false);
    }
});

test("changing a filter discards results from an older outstanding request", async () => {
    let finishOld;
    const ui = gallery((url) => {
        if (!url.pathname.endsWith("/images_stream")) return {};
        if (url.searchParams.get("username") === "new") return page([2]);
        return new Promise((resolve) => { finishOld = resolve; });
    });
    const node = ui.add(1);
    await ui.settle();
    assert.equal(typeof finishOld, "function");
    const old = ui.requests.find(({ url }) => url.pathname.endsWith("/images_stream"));
    node.control("username").value = "new";
    node.control("search").click();
    await ui.settle();
    assert.equal(old.signal.aborted, true);
    finishOld(page([1]));
    await ui.settle();
    assert.deepEqual(node.cards().map((card) => card.dataset.selkey), ["image:2"]);
});

test("removing a node cancels its active request without inserting late cards", async () => {
    let finish;
    const ui = gallery((url) => {
        if (!url.pathname.endsWith("/images_stream")) return {};
        return new Promise((resolve) => { finish = resolve; });
    });
    const node = ui.add(1);
    await ui.settle();
    const request = ui.requests.find(({ url }) => url.pathname.endsWith("/images_stream"));
    node.onRemoved();
    assert.equal(request.signal.aborted, true);
    finish(page([9]));
    await ui.settle();
    assert.equal(node.cards().length, 0);
});

test("favorites use the selected filters and request the next offset only after clicking Next", async () => {
    const ui = gallery((url) => {
        if (!url.pathname.endsWith("/get_favorites_images")) return page([1]);
        const nextPage = url.searchParams.get("offset") === "24";
        return { items: [image(nextPage ? 8 : 7)], metadata: { nextOffset: nextPage ? null : 24, totalItems: 25 } };
    });
    const node = ui.add(1);
    await ui.settle();
    node.control("scroll").scrollHeight = 4000;
    node.control("username").value = "author";
    node.control("tags").value = "5132";
    node.control("period").value = "Week";
    node.control("toggle-favonly").click();
    await ui.settle();
    function favRequests() { return ui.requests.filter(({ url }) => url.pathname.endsWith("/get_favorites_images")); }
    const params = favRequests()[0].url.searchParams;
    assert.equal(params.get("username"), "author");
    assert.equal(params.get("tags"), "5132");
    assert.equal(params.get("period"), "Week");
    assert.equal(params.get("offset"), "0");
    node.control("scroll").scrollTop = 3400;
    node.control("scroll").dispatchEvent(new Event("scroll"));
    await ui.settle();
    assert.equal(favRequests().length, 1);
    node.control("next").click();
    await ui.settle();
    assert.equal(favRequests().at(-1).url.searchParams.get("offset"), "24");
    assert.deepEqual(node.cards().map((card) => card.dataset.selkey), ["image:8"]);
});

test("an empty filtered page continues at its cursor and a repeated cursor stops loading", async () => {
    const ui = gallery((url) => url.searchParams.has("cursor") ? page([8], "same") : page([], "same"));
    const node = ui.add(1);
    await ui.settle();
    assert.equal(node.cards().length, 1);
    assert.equal(ui.requests.filter(({ url }) => url.pathname.endsWith("/images_stream")).length, 2);
    assert.match(node.control("status").textContent, /repeated page/i);
});

test("With prompt searches from page one and explains empty results with more pages", async () => {
    const ui = gallery(url => {
        if (url.searchParams.get("hide_no_prompt") !== "true") return page([1], "previous");
        const cursor = url.searchParams.get("cursor");
        return cursor === "3" ? page([8]) : page([], String(Number(cursor || 0) + 1));
    });
    const node = ui.add(1);
    await ui.settle();
    node.control("toggle-noprompt").click();
    await ui.settle();
    assert.equal(node.control("toggle-noprompt").getAttribute("aria-pressed"), "true");
    assert.match(node.control("status").textContent, /next page/i);
    node.control("next").click();
    await ui.settle();
    assert.deepEqual(node.cards().map(card => card.dataset.selkey), ["image:8"]);
});

test("videos keep their signed URL and release their source while the gallery is paused", async () => {
    const url = "https://image.civitai.com/preview.mp4?key=fixture";
    const ui = gallery((request) => request.searchParams.get("videos_only") === "true"
        ? { items: [{ id: 9, type: "video", url }], metadata: { nextCursor: null } }
        : page([1]));
    const node = ui.add(1);
    await ui.settle();
    node.control("toggle-video").click();
    await ui.settle();
    const video = node.cards()[0].querySelector("video");
    assert.equal(video.src, url);
    node.control("toggle-render").click();
    assert.equal(video.paused, true);
    assert.equal(video.getAttribute("src"), null);
    node.control("toggle-render").click();
    await ui.settle();
    assert.equal(node.cards()[0].querySelector("video").src, url);
});

test("a temporary server error can be retried without losing the cursor or the first page", async () => {
    let attempts = 0;
    const ui = gallery(url => {
        if (!url.searchParams.has("cursor")) return page([1], "page2");
        assert.equal(url.searchParams.get("cursor"), "page2");
        if (++attempts === 1) return Response.json({ error: "Civitai returned HTTP 429." }, { status: 429 });
        return page([2]);
    });
    const node = ui.add(1);
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    assert.equal(node.control("retry").hidden, false);
    assert.match(node.control("status").textContent, /429/);
    assert.equal(attempts, 1);
    node.control("retry").click();
    await ui.settle();
    assert.equal(attempts, 2);
    assert.deepEqual(node.cards().map(card => card.dataset.selkey), ["image:2"]);
});

test("a failed favorite write leaves the star off and shows the reason", async () => {
    const ui = gallery((url, signal, body) => {
        if (url.pathname.endsWith("/toggle_favorite")) {
            assert.equal(JSON.parse(body).favorite, true);
            return Response.json({ error: "Cannot save favorites." }, { status: 500 });
        }
        return page([1]);
    });
    const node = ui.add(1);
    await ui.settle();
    const star = node.cards()[0].querySelector(".cg-star");
    star.click();
    await ui.settle();
    assert.equal(star.getAttribute("aria-pressed"), "false");
    assert.match(node.control("favorite-status").textContent, /Cannot save/);
});

test("model filtering and thumbnail size survive reload and stay local to one gallery", async () => {
    const ui = gallery(url => url.pathname.endsWith("/models")
        ? { items: [{ id: 18, name: "Example", type: "LORA" }] } : page([2]));
    const node = ui.add(1);
    await ui.settle();
    const requests = ui.requests.length;
    node.control("thumb").value = "160";
    node.control("thumb").dispatchEvent(new Event("change"));
    await ui.settle();
    assert.equal(ui.requests.length, requests);
    node.control("model-query").value = "Example";
    node.control("find-model").click();
    await ui.settle();
    const model = node.control("model");
    const option = model.options.find(option => option.value === "18");
    assert.match(option.textContent, /Example.*LORA/);
    model.selectedOptions = [option];
    model.value = option.value;
    model.dispatchEvent(new Event("change"));
    await ui.settle();
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.equal(restored.control("thumb").value, "160");
    assert.equal(restored.control("model").value, "18");
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).at(-1).url.searchParams.get("modelId"), "18");
    const separate = ui.add(3);
    assert.equal(separate.control("thumb").value, "280");
    assert.equal(separate.control("model").value, "");
});

test("preview resolution preserves the workflow source, page controls and saved node size", async () => {
    const url = "https://image.civitai.com/account/id/width=2048/test.jpg";
    const ui = gallery(request => ({
        items: [{ ...image(request.searchParams.has("cursor") ? 2 : 1), url }],
        metadata: { nextCursor: request.searchParams.has("cursor") ? null : "p2" },
    }));
    const node = ui.add(1);
    await ui.settle();
    assert.equal(node.cards()[0].querySelector("img").src, url.replace("2048", "512"));
    node.control("resolution").value = "256";
    node.control("resolution").dispatchEvent(new Event("change"));
    assert.equal(node.cards()[0].querySelector("img").src, url.replace("2048", "256"));
    node.cards()[0].click();
    assert.equal((await node.queueSelection()).item.url, url);
    node.control("next").click();
    await ui.settle();
    assert.equal(node.cards()[0].dataset.selkey, "image:2");
    node.control("prev").click();
    await ui.settle();
    assert.equal(node.cards()[0].dataset.selkey, "image:1");
    node.control("numbers").children[1].click();
    await ui.settle();
    assert.equal(node.cards()[0].dataset.selkey, "image:2");
    node.control("first").click();
    await ui.settle();
    const restored = ui.add(2, { ...node.save(), size: [954, 641] });
    await ui.settle();
    assert.deepEqual(Array.from(restored.size), [954, 641]);
    restored.cards()[0].click();
    assert.deepEqual(Array.from(restored.size), [954, 641]);
    assert.equal(restored.control("resolution").value, "256");
});

test("a direct Civitai storage URL is preserved for the preview and connected image output", async () => {
    const urls = ["https://image-b2.civitai.com/file/civitai-media-cache/abc/original",
        "https://blobs-b2.civitai.com/file/blobs-managed-public/example"];
    const ui = gallery(() => ({ items: urls.map((url, i) => ({ ...image(i + 1), url })), metadata: {} }));
    const node = ui.add(1);
    await ui.settle();
    node.outputs[2].links = [42];
    for (const [i, url] of urls.entries()) {
        const card = node.cards()[i];
        assert.equal(card.querySelector("img").src, url);
        card.click();
        const selection = await node.queueSelection();
        assert.equal(selection.download_image, true);
        assert.equal(selection.item.url, url);
    }
});

test("clearing a model search discards late suggestions and removes the selected filter", async () => {
    let finish;
    const ui = gallery(url => url.pathname.endsWith("/models")
        ? new Promise(resolve => { finish = resolve; }) : page([1]));
    const node = ui.add(1, { properties: { __cg: { model: { id: "9", label: "Example" } } }, widgets_values: ["{}"] });
    await ui.settle();
    node.control("model-query").value = "example";
    node.control("find-model").click();
    await ui.settle();
    node.control("clear-model").click();
    finish({ items: [{ id: 12, name: "Late", type: "LORA" }] });
    await ui.settle();
    assert.equal(node.control("model-query").value, "");
    assert.equal(node.control("model").options.length, 1);
    assert.equal(node.control("model").value, "");
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).at(-1).url.searchParams.has("modelId"), false);
});

test("reopening a workflow restores the online cursor and favorites offset directly", async () => {
    const ui = gallery(url => {
        if (url.pathname.endsWith("/get_favorites_images")) {
            const offset = Number(url.searchParams.get("offset"));
            return { items: [image(offset + 1)], metadata: { totalPages: 4, nextOffset: offset + 24 } };
        }
        const cursor = url.searchParams.get("cursor");
        return cursor === "third" ? page([3]) : cursor === "second" ? page([2], "third") : page([1], "second");
    });
    let node = ui.add(1);
    await ui.settle();
    for (const favorites of [false, true]) {
        if (favorites) node.control("toggle-favonly").click();
        await ui.settle();
        for (let i = 0; i < 2; i++) {
            node.control("next").click();
            await ui.settle();
        }
        const saved = node.save();
        node.onRemoved();
        const start = ui.requests.length;
        node = ui.add(2, saved);
        await ui.settle();
        const requests = ui.requests.slice(start).filter(r => !r.url.pathname.endsWith("/get_favorite_ids"));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url.searchParams.get(favorites ? "offset" : "cursor"), favorites ? "48" : "third");
        assert.match(node.control("status").textContent, /Page 3/);
        node.control("prev").click();
        await ui.settle();
        assert.match(node.control("status").textContent, /Page 2/);
    }
});

test("toolbar panels preserve the current page, avoid new requests and restore per node", async () => {
    const ui = gallery(url => url.searchParams.has("cursor") ? page([2]) : page([1], "p2"));
    const node = ui.add(1);
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    const count = ui.requests.length;
    for (const name of ["models", "view"]) {
        node.control("tab-" + name).click();
        assert.equal(node.control("panel-" + name).hidden, false);
        assert.equal(node.control("tab-" + name).getAttribute("aria-selected"), "true");
        assert.equal(node.control("panel-filters").hidden, true);
    }
    await ui.settle();
    assert.equal(ui.requests.length, count);
    assert.equal(node.cards()[0].dataset.selkey, "image:2");
    const restored = ui.add(2, node.save());
    const independent = ui.add(3);
    await ui.settle();
    assert.equal(restored.control("panel-view").hidden, false);
    assert.equal(restored.cards()[0].dataset.selkey, "image:2");
    assert.equal(independent.control("panel-filters").hidden, false);
    assert.equal(independent.control("panel-view").hidden, true);
});

test("clearing previews releases media and reloads only the saved page on explicit resume", async () => {
    const videoUrl = "https://image.civitai.com/clip.mp4";
    const ui = gallery(url => url.searchParams.has("cursor") ? {
        items: [image(2), { id: 3, type: "video", url: videoUrl, thumbnail: image(3).url }],
        metadata: { nextCursor: null },
    } : page([1], "second"));
    const node = ui.add(1);
    const other = ui.add(2);
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    const [card, clip] = node.cards();
    card.click();
    const img = card.querySelector("img"), video = clip.querySelector("video");
    assert.ok(img.src && video.src && video.poster);
    const count = ui.requests.length;
    node.control("clear-previews").click();
    await ui.settle();
    assert.equal(img.getAttribute("src"), null);
    assert.equal(video.getAttribute("src"), null);
    assert.equal(video.getAttribute("poster"), null);
    assert.equal(video.dataset.src, undefined);
    assert.equal(video.paused, true);
    assert.equal(node.control("masonry").children.length, 0);
    assert.equal(node.control("toggle-render").getAttribute("aria-pressed"), "false");
    assert.equal((await node.queueSelection()).item.id, 2);
    assert.equal(other.cards().length, 1);
    const restored = ui.add(3, node.save());
    await ui.settle();
    assert.equal(restored.cards().length, 0);
    assert.equal(ui.requests.length, count);
    node.control("toggle-render").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("cursor"), "second");
    assert.equal(node.cards().length, 2);
    assert.equal(node.cards()[0].classList.contains("selected"), true);
});

test("clear previews discards a pending page even if its response arrives late", async () => {
    let finish;
    const ui = gallery(url => !url.searchParams.has("cursor") ? page([1], "next") :
        new Promise(resolve => { finish = resolve; }));
    const node = ui.add(1);
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    const pending = ui.requests.at(-1);
    node.control("clear-previews").click();
    assert.equal(pending.signal.aborted, true);
    finish(page([2]));
    await ui.settle();
    assert.equal(node.cards().length, 0);
    node.control("toggle-render").click();
    await ui.settle();
    assert.equal(node.cards()[0].dataset.selkey, "image:1");
});
