import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildGalleryView } from "../js/gallery-view.js";
import { galleryLabels, hubLanguage, loadHubLanguage } from "../js/hub-i18n.js";
import { creatorSuggestions, modelFilters } from "../js/gallery-catalog.js";
import { readMediaLink, resourcePanel } from "../js/gallery-selection.js";
import { storagePanel } from "../js/gallery-storage.js";
import { detailPanel } from "../js/gallery-details.js";
import { galleryLibrary } from "../js/gallery-library.js";
import { collectionExplorer } from "../js/gallery-collections.js";

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
    appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
    append(...els) { for (const el of els) this.appendChild(el); }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(el => el !== this);
        this.parentNode = null;
    }
    replaceChildren(...els) { this.children = []; this.append(...els); }
    replaceWith(el) {
        const parent = this.parentNode;
        parent.children[parent.children.indexOf(this)] = el;
        el.parentNode = parent;
    }
    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] ?? null; }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0, bottom: this.clientHeight }; }
    removeAttribute(name) { delete this[name]; }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    load() {}
    focus() {}
    contains(el) { return this === el || this.children.some((child) => child.contains(el)); }
    click() { this.dispatchEvent(new Event("click")); }
}

function gallery(respond = () => page([1, 2])) {
    const requests = [];
    const frames = new Map();
    const stored = new Map();
    let frameId = 0;
    let extension;
    let locale;
    const app = { extensionManager: { setting: { get: () => locale } }, registerExtension(ext) { extension = ext; } };
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
        defaultView: { IntersectionObserver: ViewObserver, fetch: async url => Response.json(JSON.parse(readFileSync(url, "utf8"))) },
        head: new Element("head"),
        getElementById(id) { return this.head.children.find(el => el.id === id) ?? null; },
        createElement(tag) { return new Element(tag); },
    });
    vm.runInNewContext(source, {
        app, api, URL, URLSearchParams, AbortController, EventTarget, CustomEvent, console, setTimeout, clearTimeout,
        buildGalleryView, creatorSuggestions, modelFilters, readMediaLink, resourcePanel, storagePanel, detailPanel, galleryLibrary,
        collectionExplorer, galleryLabels, hubLanguage, loadHubLanguage, document, previewImages: () => ({
            show(el, url, attr = "src") { el.setAttribute(attr, url); },
            release(el) { el?.removeAttribute(el.tagName === "VIDEO" ? "poster" : "src"); },
            source(el) { return el?.getAttribute("src"); }, async clear() { return 3; },
        }),
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
        async setLocale(value) { locale = value; await extension.beforeConfigureGraph(); },
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
        if (url.pathname.endsWith("/collections")) return { items: [] };
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
    assert.equal(node.control("collections-entry").hidden, false);
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
    assert.equal(node.control("collections-entry").hidden, false);
    assert.equal(node.control("status").textContent, "Page 2 / 2 (1)");
    const requestsBeforeOpen = favRequests().length;
    node.control("collections-entry").click();
    await ui.settle();
    node.control("explorer-close").click();
    assert.equal(favRequests().length, requestsBeforeOpen);
    assert.equal(node.control("status").textContent, "Page 2 / 2 (1)");
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

test("Storage browses the host, shares saved changes and restores the portable Documents default", async () => {
    const home = "/redirected/Documents/Comfyui Light_x02/Civitai Discovery Hub";
    const label = "Documents/Comfyui Light_x02/Civitai Discovery Hub";
    let folder = home;
    const ui = gallery((url, signal, body) => {
        if (!url.pathname.endsWith("/storage")) return page([8]);
        if (url.searchParams.has("browse")) return { folder: url.searchParams.get("browse"), parent: "/redirected/Documents", drives: [],
            children: [{ name: "My favorites", path: "/chosen" }] };
        if (body) {
            const value = JSON.parse(body).folder;
            if (value === "/busy") return new Response(JSON.stringify({ error: "Folder unavailable" }), { status: 409 });
            folder = value;
        }
        return { folder, defaultFolder: home, defaultLabel: label };
    });
    const first = ui.add(1), other = ui.add(2);
    await ui.settle();
    assert.ok(ui.requests.every(r => !r.url.pathname.endsWith("/storage")));
    first.control("tab-storage").click();
    other.control("tab-storage").click();
    await ui.settle();
    const input = first.control("folder"), save = first.control("folder-save");
    assert.equal(input.value, label);
    first.control("folder-browse").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("browse"), home);
    assert.equal(first.control("folder-list").hidden, false);
    assert.ok(first.control("folder-list").options.some(o => o.value === "/chosen"));
    first.control("folder-list").value = "/chosen";
    first.control("folder-list").dispatchEvent(new Event("change"));
    await ui.settle();
    assert.equal(input.value, "/chosen");
    assert.equal(folder, home);
    input.value = "/busy";
    input.dispatchEvent(new Event("input"));
    save.click();
    await ui.settle();
    assert.match(first.control("folder-status").textContent, /unavailable/);
    assert.equal(other.control("folder").value, label);
    input.value = "/chosen";
    input.dispatchEvent(new Event("input"));
    save.click();
    await ui.settle();
    assert.equal(other.control("folder").value, "/chosen");
    assert.doesNotMatch(JSON.stringify(first.save()), /chosen|redirected/);
    first.control("folder-default").click();
    assert.equal(input.value, label);
    assert.equal(folder, "/chosen");
    save.click();
    await ui.settle();
    assert.equal(folder, home);
    assert.equal(other.control("folder").value, label);
    assert.equal(first.cards()[0].dataset.selkey, "image:8");
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

test("Display OFF releases media and Display ON reloads only the saved page", async () => {
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
    assert.equal(clip.querySelector("video"), null);
    clip.querySelector(".cg-play-preview").click();
    const img = card.querySelector("img"), video = clip.querySelector("video");
    assert.ok(img.src && video.src && video.poster);
    const count = ui.requests.length;
    assert.equal(node.control("clear-previews"), null);
    node.control("toggle-render").click();
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

test("Display OFF discards a pending page even if its response arrives late", async () => {
    let finish;
    const ui = gallery(url => !url.searchParams.has("cursor") ? page([1], "next") :
        new Promise(resolve => { finish = resolve; }));
    const node = ui.add(1);
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    const pending = ui.requests.at(-1);
    node.control("toggle-render").click();
    assert.equal(pending.signal.aborted, true);
    finish(page([2]));
    await ui.settle();
    assert.equal(node.cards().length, 0);
    node.control("toggle-render").click();
    await ui.settle();
    assert.equal(node.cards()[0].dataset.selkey, "image:1");
});

test("models, exact versions, bases and multiple removable tags survive workflow restore", async () => {
    const ui = gallery(url => url.pathname.endsWith("/models") ? { items: [{ id: 9, type: "LORA", name: "Sky",
        versions: [{ id: 17, name: "Summer" }, { id: 18, name: "Winter", baseModel: "ZImageTurbo" },
            { id: 19, name: "Spring", baseModel: "Pony" }] }] }
        : url.pathname.endsWith("/bases") ? { items: ["ZImageTurbo", "Flux.1 D", "New family"] }
        : url.pathname.endsWith("/versions") ? { items: [{ id: 17, name: "Summer" }, { id: 18, name: "Winter" }] } : page([1]));
    const node = ui.add(1);
    await ui.settle();
    const change = (name, value) => {
        const input = node.control(name);
        input.value = value;
        input.selectedOptions = input.options.filter(o => o.value === value);
        input.dispatchEvent(new Event("change"));
    };
    node.control("base").dispatchEvent(new Event("focus"));
    await ui.settle();
    assert.ok(node.control("base").options.some(o => o.value === "New family"));
    change("base", "ZImageTurbo");
    node.control("model-query").value = "Sky";
    node.control("find-model").click();
    await ui.settle();
    change("model", "9");
    assert.deepEqual(node.control("version").options.map(o => o.value), ["", "17", "18"]);
    change("version", "18");
    change("tags", "5499");
    change("tags", "5207");
    await ui.settle();
    const [dragon, fantasy] = node.control("tag-chips").children;
    assert.match(fantasy.textContent, /Fantasy/);
    assert.match(dragon.textContent, /Dragon/);
    const restored = ui.add(2, node.save());
    await ui.settle();
    const stream = () => ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).at(-1).url.searchParams;
    assert.deepEqual(["modelId", "modelVersionId", "baseModels", "tags"].map(k => stream().get(k)), ["9", "18", "ZImageTurbo", "5499,5207"]);
    assert.equal(restored.control("version").value, "18");
    restored.control("version").dispatchEvent(new Event("focus"));
    await ui.settle();
    assert.equal(restored.control("version").options.length, 3);
    restored.control("tag-chips").children[0].click();
    await ui.settle();
    assert.equal(stream().get("tags"), "5207");
    restored.control("clear-model").click();
    await ui.settle();
    assert.equal(stream().has("modelVersionId"), false);
    assert.equal(stream().get("baseModels"), "ZImageTurbo");
    change("base", "Flux.1 D");
    await ui.settle();
    assert.equal(node.control("model").value, "");
    assert.equal(node.control("version").disabled, true);
    assert.equal(stream().has("modelId"), false);
});

test("model type groups mixed results and keeps a compatible gallery, version and page", async () => {
    const records = [
        { id: 10, name: "Moon", type: "Checkpoint" },
        { id: 11, name: "Moon", type: "LORA", versions: [{ id: 111, name: "v1" }] },
    ];
    const ui = gallery(url => url.pathname.endsWith("/models") ? { items: records }
        : url.searchParams.has("cursor") ? page([8]) : page([7], "second"));
    const node = ui.add(1);
    await ui.settle();
    const change = (name, value) => {
        const select = node.control(name);
        select.value = value;
        select.selectedOptions = select.options.filter(o => o.value === value);
        select.dispatchEvent(new Event("change"));
    };
    const model = node.control("model");
    const catalog = () => ui.requests.filter(r => r.url.pathname.endsWith("/models"));
    const pages = () => ui.requests.filter(r => r.url.pathname.endsWith("/images_stream"));
    assert.deepEqual(node.control("model-type").options.map(o => o.textContent), ["All types", "Checkpoints", "LoRAs"]);
    node.control("model-query").value = "Moon";
    node.control("find-model").click();
    await ui.settle();
    assert.equal(catalog().at(-1).url.searchParams.has("modelType"), false);
    assert.deepEqual(model.querySelectorAll("optgroup").map(g => [g.label, g.children[0].value]), [["Checkpoints", "10"], ["LoRAs", "11"]]);
    change("model", "11");
    change("version", "111");
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    const before = pages().length;
    change("model-type", "LORA");
    await ui.settle();
    assert.equal(catalog().at(-1).url.searchParams.get("modelType"), "LORA");
    assert.equal(catalog().at(-1).url.searchParams.get("query"), "Moon");
    assert.deepEqual(model.options.map(o => o.value), ["", "11"]);
    assert.equal(node.control("version").value, "111");
    assert.equal(pages().length, before);
    assert.match(node.control("status").textContent, /Page 2/);
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.equal(restored.control("model-type").value, "LORA");
    assert.equal(restored.control("model").value, "11");
    assert.equal(restored.control("version").value, "111");
    assert.equal(pages().at(-1).url.searchParams.get("cursor"), "second");
    assert.equal(catalog().length, 2);
    restored.control("model").dispatchEvent(new Event("pointerenter"));
    restored.control("model").dispatchEvent(new Event("focus"));
    await ui.settle();
    assert.equal(catalog().length, 3);
    assert.equal(catalog().at(-1).url.searchParams.get("modelType"), "LORA");
    assert.equal(catalog().at(-1).url.searchParams.has("query"), false);
    assert.deepEqual(restored.control("model").options.map(o => o.value), ["", "11"]);
    const independent = ui.add(3);
    await ui.settle();
    assert.equal(independent.control("model-type").value, "");
    change("model-type", "Checkpoint");
    await ui.settle();
    assert.equal(model.value, "");
    assert.equal(node.control("version").disabled, true);
    assert.deepEqual(model.options.map(o => o.value), ["", "10"]);
    assert.equal(pages().at(-1).url.searchParams.has("modelId"), false);
    assert.equal(restored.control("model").value, "11");
});

test("browsing a model type without a name preserves legacy matches and ignores late replies", async () => {
    const pending = new Map();
    const ui = gallery(url => url.pathname.endsWith("/models")
        ? new Promise(resolve => pending.set(url.searchParams.get("modelType"), resolve)) : page([1]));
    const node = ui.add(1, { properties: { __cg: { filters: { baseModels: "SDXL 1.0" },
        model: { id: "10", label: "Moon (Checkpoint #10)", version: { id: "111", label: "v1" } } } }, widgets_values: ["{}"] });
    await ui.settle();
    const type = node.control("model-type");
    const change = value => { type.value = value; type.dispatchEvent(new Event("change")); };
    const initialPages = ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).length;
    change("Checkpoint");
    const first = ui.requests.at(-1);
    assert.equal(first.url.searchParams.has("query"), false);
    assert.equal(first.url.searchParams.get("baseModels"), "SDXL 1.0");
    assert.equal(node.control("version").value, "111");
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).length, initialPages);
    change("LORA");
    assert.equal(first.signal.aborted, true);
    pending.get("LORA")({ items: [{ id: 90, name: "Ink", type: "LORA" }] });
    pending.get("Checkpoint")({ items: [{ id: 10, name: "Late result", type: "Checkpoint" }] });
    await ui.settle();
    assert.deepEqual(node.control("model").options.map(o => o.value), ["", "90"]);
    assert.equal(node.control("version").value, "");
    node.control("toggle-favonly").click();
    await ui.settle();
    assert.equal(type.disabled, true);
    node.control("toggle-favonly").click();
    await ui.settle();
    assert.equal(type.disabled, false);
    assert.equal(type.value, "LORA");
});

test("typing a model name updates the count once for the latest search without applying an image filter", async () => {
    const pending = new Map();
    const ui = gallery(url => url.pathname.endsWith("/models")
        ? new Promise(resolve => pending.set(url.searchParams.get("query"), resolve)) : page([8]));
    const node = ui.add(1, { properties: { __cg: { model: { id: "42", label: "Previous model" } } }, widgets_values: ["{}"] });
    await ui.settle();
    node.control("tab-models").click();
    const input = node.control("model-query"), status = node.control("model-status"), count = node.control("model-count");
    const enter = () => input.dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" }));
    const type = value => { input.value = value; input.dispatchEvent(new Event("input")); };
    const calls = () => ui.requests.filter(r => r.url.pathname.endsWith("/models"));
    type("M");
    type("Mo");
    assert.equal(calls().length, 0);
    assert.equal(count.textContent, "");
    assert.match(status.textContent, /Searching/);
    await new Promise(resolve => setTimeout(resolve, 400));
    const first = calls()[0];
    assert.equal(first.url.searchParams.get("query"), "Mo");
    node.control("find-model").click();
    assert.equal(calls().length, 1);
    type("Moon");
    assert.equal(first.signal.aborted, true);
    enter();
    pending.get("Mo")({ items: [], metadata: { hasMore: false } });
    await ui.settle();
    assert.equal(count.textContent, "");
    assert.match(status.textContent, /Searching/);
    pending.get("Moon")({ items: [{ id: 7, type: "LORA", name: "Moon" }], metadata: { hasMore: false } });
    await ui.settle();
    assert.equal(node.control("model").options.length, 3); // All models, the pinned selection and one match.
    assert.equal(count.textContent, "1 matching model");
    assert.equal(node.control("model-criteria").textContent, "“Moon”");
    assert.equal(status.textContent, "Model filter updated.");
    assert.match(node.control("applied-brief").textContent, /Previous model/);
    assert.doesNotMatch(node.control("applied-brief").textContent, /Moon/);
    enter();
    await new Promise(resolve => setTimeout(resolve, 390));
    assert.equal(calls().length, 2);
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).length, 1);
});

test("model feedback handles partial counts, empty results, errors, clearing and cancelled typing", async () => {
    const rows = Array.from({ length: 30 }, (_, id) => ({ id: id + 1, type: "LORA", name: "Model " + id }));
    const responses = {
        known: { items: rows, metadata: { hasMore: true, totalItems: 98 } },
        partial: { items: rows, metadata: { hasMore: true } }, empty: { items: [], metadata: { hasMore: false } },
        error: new Response("{}", { status: 503, statusText: "Unavailable" }),
    };
    const ui = gallery(url => url.pathname.endsWith("/models") ? responses[url.searchParams.get("query")] : page([1]));
    const node = ui.add(1);
    await ui.settle();
    node.control("tab-models").click();
    const input = node.control("model-query"), count = node.control("model-count"), status = node.control("model-status");
    for (const [query, expected] of [["known", "30 of 98 matching models shown"], ["partial", "30 models shown · more pages available"],
        ["empty", "0 matching models"], ["error", ""]]) {
        input.value = query;
        input.dispatchEvent(new Event("input"));
        node.control("find-model").click();
        await ui.settle();
        assert.equal(count.textContent, expected);
    }
    assert.equal(status.dataset.state, "error");
    assert.match(status.textContent, /503/);
    input.value = "unfinished";
    input.dispatchEvent(new Event("input"));
    node.control("tab-view").click();
    await new Promise(resolve => setTimeout(resolve, 390));
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/models")).length, 4);
    node.control("clear-model").click();
    assert.equal(count.textContent, "");
    assert.equal(status.textContent, "");
});

test("clearing a model name restores the match count for the selected base model", async () => {
    const models = [{ id: 1, name: "Moon", type: "Checkpoint" }, { id: 2, name: "Ink", type: "LORA" }];
    const ui = gallery(url => url.pathname.endsWith("/models") ? {
        items: url.searchParams.has("query") ? [models[0]] : models, metadata: { hasMore: false },
    } : page([8]));
    const node = ui.add(1, { properties: { __cg: { filters: { baseModels: "Krea 2" } } }, widgets_values: ["{}"] });
    await ui.settle();
    node.control("tab-models").click();
    await ui.settle();
    assert.equal(node.control("model-count").textContent, "2 matching models");
    node.control("model-query").value = "Moon";
    node.control("find-model").click();
    await ui.settle();
    assert.equal(node.control("model-count").textContent, "1 matching model");
    node.control("clear-model").click();
    await ui.settle();
    const lastSearch = ui.requests.filter(r => r.url.pathname.endsWith("/models")).at(-1).url.searchParams;
    assert.deepEqual([...lastSearch], [["baseModels", "Krea 2"]]);
    assert.equal(node.control("model-count").textContent, "2 matching models");
    assert.equal(node.control("model-criteria").textContent, "Krea 2");
});

test("the gallery summary follows committed filters, favorites and direct links independently of model search", async () => {
    const ui = gallery(url => url.pathname.endsWith("/models") ? { items: [], metadata: { hasMore: false } }
        : url.pathname.endsWith("/get_favorites_images") ? { ...page([8]), metadata: { totalPages: 1 } } : page([8]));
    const node = ui.add(1, { properties: { __cg: { filters: { nsfw: "Soft", baseModels: "Krea 2", sort: "Most Collected",
        tags: "4,5499,5133", videos_only: true, hide_no_prompt: true, period: "Week" },
        model: { id: "77", label: "Moon (LORA #77)", type: "LORA", version: { id: "770", label: "v2" } } } },
        widgets_values: ["{}"] });
    await ui.settle();
    function details() {
        const rows = node.control("applied-list").children;
        return Object.fromEntries(rows.filter(el => el.tagName === "DT").map((el, index) => [el.textContent, rows[index * 2 + 1].textContent]));
    }
    const brief = node.control("applied-brief");
    assert.doesNotMatch(brief.textContent, /Tags|Anime|Dragon|Woman/);
    assert.equal(details().Tags, undefined);
    assert.match(node.control("tag-chips").children.map(chip => chip.textContent).join(" "), /Anime.*Dragon.*Woman/);
    assert.equal(details().Prompt, "With prompt");
    assert.equal(details()["Base model"], "Krea 2");
    assert.equal(details().Version, "v2");
    assert.equal(details().Media, "Videos");
    assert.equal(details().Period, "Week");
    node.control("username").value = "artist";
    assert.equal(details().Creator, undefined);
    node.control("search").click();
    assert.equal(details().Creator, "artist");
    const committed = details();
    node.control("tab-models").click();
    node.control("model-query").value = "Other";
    node.control("find-model").click();
    await ui.settle();
    assert.deepEqual(details(), committed);
    assert.match(node.control("model-criteria").textContent, /Krea 2.*Other/);
    node.control("toggle-favonly").click();
    assert.equal(details().Source, "Favorites");
    assert.equal(details().Model, undefined);
    assert.equal(details().Version, undefined);
    assert.equal(details().Sort, "Newest");
    node.control("link-input").value = "https://civitai.com/posts/15";
    node.control("open-link").click();
    assert.deepEqual(details(), { Media: "Images and videos", NSFW: "Soft" });
    node.control("back-gallery").click();
    assert.equal(details().Source, "Favorites");
    node.control("toggle-favonly").click();
    assert.deepEqual(details(), committed);
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.equal(restored.control("applied-brief").textContent, brief.textContent);
});

test("linked image selects the workflow media and Back restores the previous filters and cursor", async () => {
    const ui = gallery(url => url.searchParams.has("imageId") ? page([92])
        : url.searchParams.has("postId") ? page([31, 32]) : url.searchParams.has("cursor") ? page([2]) : page([1], "more"));
    const node = ui.add(1);
    await ui.settle();
    node.control("username").value = "artist";
    node.control("search").click();
    await ui.settle();
    node.control("next").click();
    await ui.settle();
    node.control("tab-link").click();
    node.control("link-input").value = "https://civitai.com/images/92?postId=15";
    node.control("open-link").click();
    await ui.settle();
    const request = ui.requests.at(-1).url;
    assert.equal(request.searchParams.get("imageId"), "92");
    assert.equal(request.searchParams.get("include_videos"), "true");
    assert.equal(request.searchParams.get("period"), "AllTime");
    assert.equal(request.searchParams.get("sort"), "Oldest");
    assert.equal(request.searchParams.has("username"), false);
    assert.equal((await node.queueSelection()).item.id, 92);
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.equal(restored.control("link-label").textContent, "Image #92");
    restored.control("link-input").value = "https://civitai.com/posts/15/example";
    restored.control("open-link").click();
    await ui.settle();
    assert.equal(restored.cards().length, 2);
    assert.equal((await restored.queueSelection()).item.id, 92);
    restored.control("back-gallery").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("cursor"), "more");
    assert.equal(ui.requests.at(-1).url.searchParams.get("username"), "artist");
    assert.match(restored.control("status").textContent, /Page 2/);
    assert.equal(restored.control("link-source").hidden, true);
});

test("only official image and post links are accepted and an invalid URL keeps the current page", async () => {
    for (const text of ["", "https://example.com/images/4", "https://civitai.com.example.com/images/4",
        "https://civitai.com:123/images/4", "https://test@civitai.com/images/4", "https://civitai.com/models/4",
        "http://civitai.com/images/4", "https://civitai.com/images/0", "https://civitai.com/images/1234567890987654321"]) {
        assert.equal(readMediaLink(text), null);
    }
    assert.deepEqual(readMediaLink(" https://www.civitai.com/posts/25/name/ "), { kind: "post", id: "25" });
    const ui = gallery(), node = ui.add(1);
    await ui.settle();
    node.control("link-input").value = "https://example.com/posts/3";
    const count = ui.requests.length;
    node.control("open-link").click();
    assert.equal(ui.requests.length, count);
    assert.match(node.control("link-status").textContent, /Civitai/);
    assert.equal(node.cards().length, 2);
});

test("a 150-item random draw restores by ID in order, handles missing items, and only shuffles on request", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => 151 - i);
    const ui = gallery(url => {
        if (url.searchParams.has("ids")) return page(url.searchParams.get("ids").split(",").map(Number).filter(id => id !== 27).reverse());
        if (url.searchParams.get("sort") === "Random") return url.searchParams.get("cursor") ? page([500]) : page(ids, "more");
        return page([1]);
    });
    const node = ui.add(1);
    await ui.settle();
    node.control("limit").value = "150";
    node.control("period").value = "Day";
    node.control("sort").value = "Random";
    node.control("sort").dispatchEvent(new Event("change"));
    await ui.settle();
    assert.equal(node.control("shuffle").hidden, false);
    assert.equal(node.control("next").hidden, true);
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.deepEqual(ui.requests.filter(r => r.url.searchParams.has("ids")).map(r => r.url.searchParams.get("ids").split(",").length), [100, 50]);
    assert.ok(ui.requests.filter(r => r.url.searchParams.has("ids")).every(r => r.url.searchParams.get("period") === "AllTime"));
    assert.deepEqual(restored.cards().map(c => c.dataset.selkey), ids.filter(id => id !== 27).map(id => "image:" + id));
    const draw = restored.cards().map(card => card.dataset.selkey);
    restored.control("toggle-render").click();
    assert.equal(restored.cards().length, 0);
    restored.control("toggle-render").click();
    await ui.settle();
    assert.deepEqual(restored.cards().map(card => card.dataset.selkey), draw);
    restored.control("shuffle").click();
    await ui.settle();
    assert.deepEqual(restored.cards().map(c => c.dataset.selkey), ["image:500"]);
    assert.equal(ui.requests.at(-1).url.searchParams.get("period"), "Day");
});

test("creator suggestions cancel stale input and do not apply a gallery filter while typing", async () => {
    let finish;
    const ui = gallery(url => url.pathname.endsWith("/creators") ? new Promise(resolve => { finish = resolve; }) : page([1]));
    const node = ui.add(1);
    await ui.settle();
    const creator = node.control("username");
    creator.value = "al";
    creator.dispatchEvent(new Event("input"));
    await new Promise(resolve => setTimeout(resolve, 320));
    const first = finish;
    creator.value = "ali";
    creator.dispatchEvent(new Event("input"));
    first({ items: ["Stale"] });
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(ui.requests.filter(r => r.url.pathname.endsWith("/images_stream")).length, 1);
    assert.equal(node.control("creators").children.length, 0);
    finish({ items: ["Alice"] });
    await ui.settle();
    assert.equal(node.control("creators").children[0].value, "Alice");
    creator.value = "Alice";
    node.control("search").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("username"), "Alice");
});

test("resources are resolved only on demand and a stale lookup cannot overwrite the new selection", async () => {
    let finish;
    const one = { ...image(4), modelVersionIds: [25], meta: { civitaiResources: [{ type: "lora", modelVersionId: 25, weight: 0.65 }] } };
    const two = { ...image(5), meta: { resources: [{ type: "checkpoint", name: "Local name", modelVersionId: 27 }] } };
    const ui = gallery(url => url.pathname.endsWith("/resource") ? new Promise(resolve => { finish = resolve; }) : { items: [one, two], metadata: {} });
    const node = ui.add(1);
    await ui.settle();
    node.cards()[0].click();
    assert.equal(node.control("resource-toggle").textContent, "Resources (1)");
    assert.equal(finish, undefined);
    node.control("resource-toggle").click();
    const list = node.control("resource-list");
    assert.equal(list.querySelector("a").href, "https://civitai.com/model-versions/25");
    assert.equal(list.querySelector(".cg-resource-weight").textContent, "Weight 0.65");
    node.cards()[1].click();
    assert.equal(ui.requests.at(-1).signal.aborted, true);
    finish({ name: "Old selection" });
    await ui.settle();
    assert.equal(list.querySelector("a").textContent, "Local name");
    assert.equal((await node.queueSelection()).item.id, 5);
});

test("legacy checkpoint names and text LoRA weights remain usable without a catalog request", async () => {
    const first = { ...image(4), meta: { Model: "Portrait XL", civitaiResources: [
        { type: "checkpoint", modelVersionId: 17 }, { type: "lora", name: "Ink", weight: "0.7" },
    ] } };
    const second = { ...image(5), meta: { model: "Older checkpoint" } };
    const ui = gallery(() => ({ items: [first, second], metadata: {} })), node = ui.add(1);
    await ui.settle();
    node.cards()[0].click();
    node.control("resource-toggle").click();
    const list = node.control("resource-list");
    assert.equal(list.children.length, 2);
    assert.equal(list.querySelector("a").textContent, "Portrait XL");
    assert.equal(list.querySelector(".cg-resource-weight").textContent, "Weight 0.7");
    node.cards()[1].click();
    assert.equal(list.children.length, 1);
    assert.equal(list.querySelector("a"), null);
    assert.equal(list.children[0].children[1].textContent, "Older checkpoint");
    assert.equal(ui.requests.some(r => r.url.pathname.endsWith("/resource")), false);
});

test("online collection ranking survives browsing favorites and local random draws can be restored", async () => {
    const ui = gallery(url => url.pathname.endsWith("/get_favorites_images")
        ? { ...page(url.searchParams.has("ids") ? [45, 9] : [9, 45]), metadata: { totalItems: 2, totalPages: 1 } } : page([1]));
    const node = ui.add(1);
    await ui.settle();
    const sort = node.control("sort");
    sort.value = "Most Collected";
    sort.dispatchEvent(new Event("change"));
    node.control("toggle-favonly").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("sort"), "Newest");
    assert.equal(node.control("collected").disabled, true);
    node.control("toggle-favonly").click();
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.searchParams.get("sort"), "Most Collected");
    node.control("toggle-favonly").click();
    sort.value = "Random";
    sort.dispatchEvent(new Event("change"));
    await ui.settle();
    const restored = ui.add(2, node.save());
    await ui.settle();
    assert.equal(ui.requests.at(-1).url.pathname, "/civitai_gallery/get_favorites_images");
    assert.equal(ui.requests.at(-1).url.searchParams.get("ids"), "9,45");
    assert.deepEqual(restored.cards().map(card => card.dataset.selkey), ["image:9", "image:45"]);
});

test("a Civitai thumbnail object displays an image until Play and releases the signed video on pause", async () => {
    const video = { id: 77, type: "video", url: "https://blobs-b2.civitai.com/clip?sig=example",
        thumbnail: { url: "https://image.civitai.com/account/id/width=1024/poster.webp", width: 800, height: 1200 } };
    const ui = gallery(() => ({ items: [video], metadata: {} })), node = ui.add(1);
    await ui.settle();
    const card = node.cards()[0];
    assert.equal(card.querySelector("video"), null);
    assert.match(card.querySelector("img").src, /width=512/);
    card.querySelector(".cg-play-preview").click();
    const player = card.querySelector("video");
    assert.equal(player.src, video.url);
    assert.equal(player.paused, false);
    node.control("toggle-render").click();
    assert.equal(player.getAttribute("src"), null);
    assert.equal(player.paused, true);
});

test("Details reuses the thumbnail, copies prompts, crosses pages and releases originals", async () => {
    const first = { ...image(1), browsingLevel: 1, width: 200, height: 300, createdAt: "2026-01-01",
        url: "https://image.civitai.com/account/id/original=true/photo.jpeg",
        meta: { id: 5, meta: { positivePrompt: "first\nsecond", negative: "blur", seed: 0, steps: 20, custom: { value: 15 } } } };
    const second = { ...image(2), nsfwLevel: "Soft", meta: {} };
    const ui = gallery(url => url.searchParams.has("cursor") ? { items: [second], metadata: {} } :
        { items: [first], metadata: { nextCursor: "two" } });
    let copied;
    ui.document.defaultView.navigator = { clipboard: { writeText: async value => { copied = value; } } };
    const node = ui.add(1);
    await ui.settle();
    const card = node.cards()[0], media = node.control("detail-media"), inspector = node.control("inspector");
    assert.equal(card.querySelector(".cg-content-rating"), null);
    assert.ok(card.querySelector(".cg-chip"));
    card.click();
    const traffic = ui.requests.length;
    node.control("detail-toggle").click();
    assert.equal(inspector.hidden, false);
    assert.equal(media.querySelector("img").src, card.querySelector("img").src);
    assert.match(media.querySelector("img").src, /width=512/);
    assert.equal(node.control("positive-text").textContent, "first\nsecond");
    assert.equal(node.control("negative-text").textContent, "blur");
    assert.deepEqual(node.control("parameters").querySelectorAll("dd").map(el => el.textContent), ["20", "0", "200 × 300"]);
    assert.equal(node.control("extra-json").textContent, "");
    const more = node.control("extra-parameters");
    more.open = true;
    more.dispatchEvent(new Event("toggle"));
    assert.deepEqual(JSON.parse(node.control("extra-json").textContent), { custom: { value: 15 } });
    node.control("copy-positive").click();
    await ui.settle();
    assert.equal(copied, "first\nsecond");
    assert.equal(node.control("copy-positive").textContent, "Copied");
    node.control("copy-negative").click();
    assert.equal(copied, "blur");
    ui.document.defaultView.navigator.clipboard.writeText = async () => { throw new Error("Clipboard permission denied"); };
    ui.document.createRange = () => ({ selectNodeContents(el) { this.value = el.textContent; } });
    let highlighted;
    ui.document.getSelection = () => ({ removeAllRanges() {}, addRange(range) { highlighted = range.value; } });
    ui.document.execCommand = action => { if (action === "copy") copied = highlighted; return action === "copy"; };
    node.control("copy-positive").click();
    await ui.settle();
    assert.equal(copied, "first\nsecond");
    node.control("detail-enlarge").click();
    const original = media.querySelector("img");
    assert.equal(original.src, first.url);
    assert.equal(ui.requests.length, traffic);
    original.dispatchEvent(new Event("error"));
    assert.equal(node.control("detail-notes").hidden, false);
    assert.equal(original.src, card.querySelector("img").src);
    assert.match(node.control("copy-status").textContent, /Original image unavailable/);
    node.control("detail-enlarge").click();
    inspector.dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowRight" }));
    await ui.settle();
    assert.equal((await node.queueSelection()).item.id, 2);
    assert.equal(original.getAttribute("src"), null);
    assert.equal(node.control("detail-notes").hidden, false);
    assert.equal(node.control("detail-next").disabled, true);
    assert.equal(node.control("extra-json").textContent, "");
    assert.equal(node.control("copy-positive").disabled, true);
    assert.match(node.cards()[0].querySelector(".cg-content-rating").title, /NSFW level: Soft/);
    node.control("detail-prev").click();
    await ui.settle();
    assert.equal((await node.queueSelection()).item.id, 1);
    inspector.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    assert.equal(inspector.hidden, true);
    assert.equal(media.children.length, 0);
    node.control("detail-toggle").click();
    node.control("detail-enlarge").click();
    const hd = media.querySelector("img");
    node.control("toggle-render").click();
    assert.equal(inspector.hidden, true);
    assert.equal(hd.getAttribute("src"), null);
    node.onRemoved();
});

test("Details shows a video poster until playback is requested and stops playback on closing", async () => {
    const item = { id: 44, type: "video", url: "https://image.civitai.com/movie.mp4",
        thumbnail: "https://image.civitai.com/a/id/width=900/poster.webp" };
    const ui = gallery(() => ({ items: [item], metadata: {} })), node = ui.add(1);
    await ui.settle();
    node.cards()[0].click();
    node.control("detail-toggle").click();
    const media = node.control("detail-media");
    assert.equal(media.querySelector("video"), null);
    assert.match(media.querySelector("img").src, /width=512/);
    node.control("detail-enlarge").click();
    const player = media.querySelector("video");
    assert.equal(player.src, item.url);
    node.control("detail-close").click();
    assert.equal(player.paused, true);
    assert.equal(player.getAttribute("src"), null);
    node.onRemoved();
});

test("named searches share applied filters, model and version across workflows without copying view settings", async () => {
    const searches = new Map();
    const ui = gallery((url, signal, body) => {
        if (url.pathname.endsWith("/searches")) {
            if (body) {
                const { action, name, settings } = JSON.parse(body);
                if (action === "delete") searches.delete(name);
                else searches.set(name, settings);
            }
            return { items: [...searches].map(([name, settings]) => ({ name, settings })) };
        }
        return page([1, 2], "next");
    });
    ui.document.defaultView.confirm = () => true;
    const source = ui.add(1, { properties: { __cg: { filters: { tags: "4,3", sort: "Random", hide_no_prompt: true,
        username: "artist", baseModels: "Pony", limit: "50" }, model_search_type: "LORA",
        model: { id: "21", label: "Model", version: { id: "32", label: "Version" } } } }, widgets_values: ["{}"] });
    await ui.settle();
    source.control("saved-toggle").click();
    await ui.settle();
    source.control("username").value = "unapplied";
    source.control("library-name").value = "Anime";
    source.control("library-name").dispatchEvent(new Event("input"));
    source.control("library-create").click();
    await ui.settle();
    assert.equal(searches.get("Anime").filters.username, "artist");
    assert.equal(searches.get("Anime").filters.limit, undefined);
    const target = ui.add(2);
    await ui.settle();
    target.control("next").click();
    await ui.settle();
    target.control("saved-toggle").click();
    await ui.settle();
    target.control("library-select").value = "Anime";
    target.control("library-select").dispatchEvent(new Event("change"));
    target.control("library-apply").click();
    await ui.settle();
    const sent = ui.requests.filter(req => req.url.pathname.endsWith("/images_stream")).at(-1).url.searchParams;
    for (const [key, value] of Object.entries({ username: "artist", sort: "Random", tags: "4,3", modelId: "21",
        modelVersionId: "32", baseModels: "Pony", min_batch: "24", hide_no_prompt: "true" })) assert.equal(sent.get(key), value, key);
    assert.equal(sent.has("cursor"), false);
    assert.equal(target.control("model-type").value, "LORA");
    assert.equal(target.control("library").hidden, true);
    target.control("username").value = "new artist";
    target.control("search").click();
    target.control("saved-toggle").click();
    await ui.settle();
    target.control("library-update").click();
    await ui.settle();
    assert.equal(searches.get("Anime").filters.username, "new artist");
    target.control("library-delete").click();
    await ui.settle();
    assert.equal(searches.size, 0);
    for (const node of [source, target]) node.onRemoved();
});

test("portrait explorer, card memberships and chosen covers follow the local profile across workflows", async () => {
    const sets = new Map(), covers = new Map(), edits = [];
    const ui = gallery((url, signal, body) => {
        if (url.pathname.endsWith("/collections")) {
            if (body) {
                const edit = JSON.parse(body);
                edits.push(edit);
                if (edit.action === "create") sets.set(edit.name, new Set());
                if (edit.action === "delete") sets.delete(edit.name);
                if (edit.action === "cover") covers.set(edit.name, edit.favoriteId);
                if (edit.favoriteId && edit.action !== "cover") {
                    if (edit.member === false) sets.get(edit.name).delete(edit.favoriteId);
                    else sets.get(edit.name).add(edit.favoriteId);
                }
                return { favoriteAdded: Boolean(edit.item) };
            }
            const id = url.searchParams.get("favoriteId");
            return { favorite: [...sets.values()].some(ids => ids.has(id)),
                items: [...sets].map(([name, ids]) => ({ name, count: ids.size, contains: ids.has(id),
                    isCover: covers.get(name) === id, coverUrl: covers.has(name) ? image(covers.get(name)).url : null })) };
        }
        const name = url.searchParams.get("collection");
        return { items: (name ? [...sets.get(name) || []].map(Number) : [1, 2]).map(image), metadata: { totalPages: 1 } };
    });
    ui.document.defaultView.confirm = () => true;
    const node = ui.add(3);
    await ui.settle();
    assert.equal(node.control("collections-entry").hidden, true);
    node.control("toggle-favonly").click();
    await ui.settle();
    node.control("collections-entry").click();
    await ui.settle();
    const grid = node.control("collection-grid");
    for (const name of ["Lighting", "Photo"]) {
        assert.ok(grid.children[0].classList.contains("cg-new-tile"));
        grid.children[0].click();
        const form = node.control("explorer-editor").querySelector("form");
        form.querySelector("input").value = name;
        form.querySelector("input").dispatchEvent(new Event("input"));
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await ui.settle();
    }
    assert.deepEqual(edits.map(row => row.action), ["create", "create"]);
    assert.equal(grid.querySelectorAll(".cg-folder-entry").length, 2);
    node.control("explorer-close").click();
    node.control("toggle-favonly").click();
    await ui.settle();
    node.cards()[0].querySelector(".cg-collect").click();
    await ui.settle();
    const choices = () => node.control("memberships").querySelectorAll(".cg-collection-choice");
    choices()[0].click();
    await ui.settle();
    assert.equal(edits.at(-1).item.id, 1);
    assert.equal(node.cards()[0].querySelector(".cg-star").getAttribute("aria-pressed"), "true");
    choices()[1].click();
    await ui.settle();
    assert.deepEqual(choices().map(el => el.getAttribute("aria-pressed")), ["true", "true"]);
    choices()[0].click();
    await ui.settle();
    assert.deepEqual(choices().map(el => el.getAttribute("aria-pressed")), ["false", "true"]);
    node.control("memberships").querySelector(".cg-cover-choice").click();
    await ui.settle();
    assert.equal(covers.get("Photo"), "1");
    assert.equal(node.control("memberships").querySelector(".cg-cover-choice").disabled, true);
    assert.equal((await node.queueSelection()).item, undefined);
    node.control("toggle-favonly").click();
    await ui.settle();
    node.control("collections-entry").click();
    await ui.settle();
    const photo = grid.querySelectorAll(".cg-folder-entry")[1].querySelector(".cg-folder-tile");
    assert.equal(photo.querySelector(".cg-folder-name").textContent, "Photo");
    assert.equal(photo.querySelector("img").src, image(1).url);
    photo.click();
    await ui.settle();
    assert.deepEqual(node.cards().map(card => card.dataset.selkey), ["image:1"]);
    assert.match(node.control("applied-brief").textContent, /Photo/);
    const restored = ui.add(4, node.save());
    await ui.settle();
    assert.deepEqual(restored.cards().map(card => card.dataset.selkey), ["image:1"]);
    node.control("collections-toggle").click();
    await ui.settle();
    grid.querySelectorAll(".cg-tile-delete")[1].click();
    await ui.settle();
    assert.equal(restored.cards().length, 2);
    assert.equal(node.properties.__cg.filters.collection, "");
    assert.equal(restored.control("collection-path").hidden, true);
    assert.equal(restored.control("collections-entry").hidden, false);
    for (const instance of [restored, node]) instance.onRemoved();
});

test("a workflow with a missing local collection can switch back to all favorites", async () => {
    const ui = gallery(url => url.pathname.endsWith("/collections") ? { items: [], favorite: false } :
        { items: url.searchParams.has("collection") ? [] : [image(7)], metadata: { totalPages: 1 } });
    const node = ui.add(1, { properties: { __cg: { filters: { favorites_only: true, collection: "Other profile" } } },
        widgets_values: ["{}"] });
    await ui.settle();
    assert.equal(node.cards().length, 0);
    node.control("collections-toggle").click();
    await ui.settle();
    assert.equal(node.control("collection-grid").querySelectorAll(".cg-folder-entry").length, 0);
    node.control("all-favorites").click();
    await ui.settle();
    assert.equal(node.cards().length, 1);
    node.onRemoved();
});

test("the Collections tile opens from empty Favorites and the breadcrumb returns to either parent", async () => {
    const name = "Ciels & lumières";
    const ui = gallery(url => {
        if (url.pathname.endsWith("/collections")) return { items: [{ name, count: 0 }] };
        return url.pathname.endsWith("/get_favorites_images") ? { items: [], metadata: { totalItems: 0 } } : page([7]);
    });
    ui.document.defaultView.navigator = { language: "fr-FR" };
    await ui.setLocale(undefined);
    const node = ui.add(1);
    await ui.settle();
    node.cards()[0].click();
    const selection = node.save().widgets_values[0];
    node.control("toggle-favonly").click();
    await ui.settle();
    const entry = node.control("collections-entry"), path = node.control("collection-path");
    assert.ok(!entry.hidden && path.hidden);
    assert.equal(node.cards().length, 0);
    entry.click();
    await ui.settle();
    assert.ok(!path.hidden && node.control("collection-parent").hidden);
    assert.equal(node.control("all-favorites").textContent, "Tous les favoris");
    assert.equal(node.control("current-collection").textContent, "Collections");
    node.control("collection-grid").querySelector(".cg-folder-entry").querySelector(".cg-folder-tile").click();
    await ui.settle();
    assert.ok(entry.hidden && !path.hidden && !node.control("collection-parent").hidden);
    assert.equal(node.control("current-collection").textContent, name);
    assert.equal(node.control("explorer").hidden, true);
    assert.equal(node.properties.__cg.filters.collection, name);
    node.control("collections-toggle").click();
    await ui.settle();
    assert.equal(node.control("explorer").hidden, false);
    assert.equal(node.control("current-collection").textContent, "Collections");
    node.control("explorer-close").click();
    assert.equal(node.control("current-collection").textContent, name);
    node.control("all-favorites").click();
    await ui.settle();
    assert.ok(!entry.hidden && path.hidden);
    assert.equal(node.properties.__cg.filters.favorites_only, true);
    assert.equal(node.properties.__cg.filters.collection, "");
    assert.equal(node.save().widgets_values[0], selection);
    node.onRemoved();
});

test("a late membership lookup cannot file the next card under the previous ID", async () => {
    let release, written;
    const ui = gallery((url, signal, body) => {
        if (!url.pathname.endsWith("/collections")) return { items: [image(1), image(2)], metadata: { totalPages: 1 } };
        if (body) { written = JSON.parse(body); return {}; }
        if (url.searchParams.get("favoriteId") === "1") return new Promise(resolve => { release = resolve; });
        return { favorite: true, items: [{ name: "Lighting", count: 1, contains: false }] };
    });
    ui.document.defaultView.navigator = { language: "fr-FR" };
    await ui.setLocale(undefined);
    const node = ui.add(1);
    await ui.settle();
    assert.ok(!ui.requests.some(({ url }) => url.pathname.endsWith("/collections")));
    assert.equal(node.cards()[0].querySelector(".cg-collect").textContent, "Ajouter à une collection");
    node.cards()[0].querySelector(".cg-collect").click();
    node.cards()[1].querySelector(".cg-collect").click();
    await ui.settle();
    release({ favorite: true, items: [{ name: "Lighting", count: 1, contains: true }] });
    await ui.settle();
    const choice = node.control("memberships").querySelector(".cg-collection-choice");
    assert.equal(choice.getAttribute("aria-pressed"), "false");
    choice.click();
    await ui.settle();
    assert.deepEqual(written, { action: "membership", name: "Lighting", favoriteId: "2", member: true });
    node.control("toggle-render").click();
    assert.equal(node.control("collection-menu").hidden, true);
    assert.equal(node.control("clear-cache").textContent, "Vider le cache des images");
    node.control("clear-cache").click();
    await ui.settle();
    assert.equal(node.control("cache-status").textContent, "3 aperçus supprimés.");
    node.onRemoved();
});

test("changing ComfyUI language restores the page and filter values and preserves names and prompts", async () => {
    const ui = gallery(url => url.searchParams.has("cursor") ? page([2]) : page([1], "second"));
    ui.document.defaultView.navigator = { language: "fr-FR" };
    await ui.setLocale("es-MX");
    const first = ui.add(1);
    await ui.settle();
    first.control("username").value = "Favorites";
    first.control("sort").value = "Most Reactions";
    first.control("period").value = "Week";
    first.control("search").click();
    await ui.settle();
    first.control("next").click();
    await ui.settle();
    first.cards()[0].click();
    assert.equal(first.root.lang, "es");
    assert.equal(first.control("selection").textContent, "Selección n.º 2");
    const saved = first.save();
    first.onRemoved();
    for (const [locale, language, selected, week] of [
        ["en-US", "en", "Selected #2", "Week"], ["fr-CA", "fr", "Sélection n° 2", "Semaine"],
        ["zh-Hans", "zh", "已选择 #2", "近一周"], ["zh-Hant", "zh-TW", "已選取 #2", "近一週"],
        ["ja-JP", "ja", "選択中：#2", "過去1週間"], ["ko-KR", "ko", "선택 항목 #2", "최근 1주"],
        ["de-DE", "en", "Selected #2", "Week"],
    ]) {
        await ui.setLocale(locale);
        const node = ui.add(2, saved);
        await ui.settle();
        assert.equal(node.root.lang, language);
        assert.equal(node.control("selection").textContent, selected);
        assert.ok(node.control("applied-brief").textContent.includes(week));
        assert.ok(node.control("applied-brief").textContent.includes("Favorites"));
        const stream = ui.requests.filter(row => row.url.pathname.endsWith("/images_stream")).at(-1).url;
        assert.deepEqual(["cursor", "username", "sort", "period"].map(key => stream.searchParams.get(key)),
            ["second", "Favorites", "Most Reactions", "Week"]);
        assert.equal((await node.queueSelection()).item.meta.prompt, "prompt 2");
        node.onRemoved();
    }
});

test("gallery errors keep the server status code in the selected language", async () => {
    const ui = gallery(() => Response.json({ error: "Civitai returned HTTP 429." }, { status: 429 }));
    await ui.setLocale("fr");
    const node = ui.add(1);
    await ui.settle();
    assert.equal(node.control("status").textContent, "Erreur : Civitai a renvoyé l’erreur HTTP 429.");
    node.onRemoved();
});
