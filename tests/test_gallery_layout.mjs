import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const browser = [
    process.env.CHROME_BIN,
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Google/Chrome/Application/chrome.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(file => file && existsSync(file));

test("mixed-aspect pages pack continuously while scrolling and resizing in classic and Nodes 2.0", {
    skip: browser ? false : "Requires Edge or Chromium",
}, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cdh-gallery-layout-"));
    try {
        copyFileSync(new URL("../js/gallery.css", import.meta.url), path.join(dir, "gallery.css"));
        copyFileSync(new URL("../js/collections.webp", import.meta.url), path.join(dir, "collections.webp"));
        const languages = ["en", "fr", "es", "zh", "zh-TW", "ja", "ko"];
        mkdirSync(path.join(dir, "locales"));
        for (const language of languages.slice(1)) {
            const file = language + ".json";
            copyFileSync(new URL("../js/locales/" + file, import.meta.url), path.join(dir, "locales", file));
        }
        const view = ["hub-i18n.js", "gallery-view.js", "gallery-catalog.js", "gallery-selection.js", "gallery-storage.js", "gallery-details.js",
            "gallery-library.js", "gallery-collections.js", "gallery-preview-cache.js"]
            .map(file => readFileSync(new URL("../js/" + file, import.meta.url), "utf8")).join("\n");
        const controller = readFileSync(new URL("../js/Civitai_Discovery_Hub.js", import.meta.url), "utf8")
            .replace(/^import .*;$/gm, "");
        const fixture = path.join(dir, "layout.html");
        // Nodes 2.0 gives the node a minimum height and its DOM widget an auto-sized grid row.
        writeFileSync(fixture, `<!doctype html><meta charset="utf-8">
<link id="civitai-discovery-hub-stylesheet" rel="stylesheet" href="gallery.css">
<style>
  * { box-sizing: border-box }
  .node { position: absolute; display: flex; flex-direction: column; min-height: var(--node-height) }
  .body { flex: 1; display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px }
  .grid { flex: 1; display: grid; grid-template-columns: 12px minmax(80px,min-content) 1fr; grid-template-rows: auto }
  .row { display: grid; grid-template-columns: subgrid; grid-column: 1/-1 }
  .mount { grid-column: span 2; display: flex; flex-direction: column }
  .mount > * { flex: 1 }
</style>
<div class="node"><div class="body"><div style="height:110px"></div><div class="grid">
  <div class="row"><div></div><div class="mount"></div></div>
</div></div></div>
<div class="classic"></div><img id="collection-art" src="collections.webp" alt="" hidden><output></output>
<script type="module">
const report = document.querySelector("output");
window.addEventListener("error", event => { report.textContent = JSON.stringify({ error: event.error?.stack || event.message }); });
window.addEventListener("unhandledrejection", event => { report.textContent = JSON.stringify({ error: String(event.reason) }); });
${view}
let locale;
const app = { extensionManager: { setting: { get: () => locale } }, registerExtension() {} };
${controller}
let items;
const api = { async fetchApi(path) {
    if (path.startsWith("/civitai_gallery/searches")) return { ok: true, json: async () => ({ items: [] }) };
    if (path.startsWith("/civitai_gallery/collections")) return { ok: true, json: async () => ({
        favorite: true, items: [{ name: "Reference photos", count: 2, contains: true }] }) };
    if (path.startsWith("/civitai_gallery/storage?")) return { ok: true, json: async () => ({
        folder: "/home/test/Documents/Hub", parent: "/home/test/Documents", children: [], drives: [] }) };
    if (path.startsWith("/civitai_gallery/models?")) {
        const type = new URLSearchParams(path.split("?")[1]).get("modelType");
        const models = [{ id: 11, type: "Checkpoint", name: "Moon" }, { id: 12, type: "LORA", name: "Moon" }];
        return { ok: true, json: async () => ({ items: models.filter(item => !type || item.type === type), metadata: { hasMore: false } }) };
    }
    const data = path.endsWith("/storage") ? { folder: "/home/test/Documents/Hub", defaultFolder: "/home/test/Documents/Hub", defaultLabel: "Documents/Hub" } :
        path.endsWith("/get_favorite_ids") ? { ids: [] } :
        path.includes("cursor=second") || path.includes("postId=") || path.includes("tags=")
            ? { items, metadata: {} } : { items: [{ id: 999 }], metadata: { nextCursor: "second" } };
    return { ok: true, json: async () => data };
} };
// Deliver observer updates explicitly so headless frame timing does not affect the measurements.
const observers = new Set();
class IntersectionObserver {
    constructor(callback, options = {}) {
        this.callback = callback;
        this.root = options.root;
        this.margin = parseFloat(options.rootMargin) || 0;
        this.targets = new Set();
    }
    observe(target) { this.targets.add(target); observers.add(this); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
    update() {
        const bounds = this.root?.getBoundingClientRect();
        this.callback(Array.from(this.targets, target => {
            const rect = target.getBoundingClientRect();
            return { target, isIntersecting: !bounds ||
                (rect.bottom >= bounds.top - this.margin && rect.top <= bounds.bottom + this.margin) };
        }));
    }
}
const updateVisibility = () => [...observers].forEach(observer => observer.update());
window.IntersectionObserver = IntersectionObserver;
const requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
const cancelAnimationFrame = clearTimeout;
let resize;
class ResizeObserver {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const collectionArt = document.getElementById("collection-art");
const pixel = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), ch => ch.charCodeAt(0));
const readLocal = window.fetch.bind(window);
window.fetch = async url => String(url).endsWith(".json") ? readLocal(url) : new Response(pixel, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
const measurements = [], compact = [];
for (const [host, mount] of [[".node", ".mount"], [".classic", ".classic"]]) {
    const node = document.querySelector(host);
    const container = document.querySelector(mount);
    for (const language of ${JSON.stringify(languages)}) {
        locale = language;
        await loadHubLanguage(app, document);
        const t = galleryLabels(language);
        const count = language === "fr" ? 150 : 24;
        items = Array.from({length: count}, (_, i) => ({
            id: i + 1, url: "https://image.civitai.com/" + (i + 1) + ".png", type: "image",
            width: 800, height: [1200, 460, 1600, 900, 640, 1040, 800][i % 7],
            meta: { prompt: "Long published prompt. ".repeat(80), seed: 0,
                resources: Array.from({length: 8}, (_, j) => ({ type: "lora", name: "Resource " + j, modelVersionId: j + 1 })) },
        }));
        const instance = {
            properties: {}, widgets: [{ name: "selection_data", value: "{}" }], setDirtyCanvas() {},
            addDOMWidget(name, type, root) { container.appendChild(root); return {}; },
        };
        const gallery = createGallery(instance);
        const scroll = container.querySelector(".cg-scroll"), footer = container.querySelector(".cg-foot");
        const grid = container.querySelector(".cg-masonry");
        updateVisibility();
        await tick();
        container.querySelector(".cg-next").click();
        await tick();
        for (const [width, height, thumb] of [[1580, 900, 280], [720, 420, 280], [1120, 820, 160]]) {
            node.style.width = width + "px";
            // The Vue renderer adds the title bar to the saved node height.
            const outerHeight = host === ".node" ? height + 30 : height;
            node.style.setProperty(host === ".node" ? "--node-height" : "height", outerHeight + "px");
            resize();
            await tick();
            const size = container.querySelector(".cg-thumb");
            if (size.value !== String(thumb)) { size.value = String(thumb); size.dispatchEvent(new Event("change")); }
            const positions = new Map();
            const initialHeight = scroll.scrollHeight;
            let maxMounted = 0, stable = true, aspectError = 0;
            for (let y = 0; ; y += Math.max(1, scroll.clientHeight)) {
                scroll.scrollTop = y;
                updateVisibility();
                const cards = grid.querySelectorAll(".cg-card"), origin = grid.getBoundingClientRect();
                maxMounted = Math.max(maxMounted, cards.length);
                stable &&= initialHeight === scroll.scrollHeight;
                for (const card of cards) {
                    const box = card.getBoundingClientRect();
                    const id = Number(card.dataset.selkey.slice(6)), item = items[id - 1];
                    const media = card.querySelector("img").getBoundingClientRect();
                    aspectError = Math.max(aspectError, Math.abs(media.height - media.width * item.height / item.width));
                    positions.set(id, {
                        left: box.left, top: box.top - origin.top, bottom: box.bottom - origin.top,
                    });
                }
                if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1) break;
            }
            const columns = new Map(), gaps = [];
            for (const box of positions.values()) {
                if (!columns.has(box.left)) columns.set(box.left, []);
                columns.get(box.left).push(box);
            }
            for (const column of columns.values()) {
                column.sort((a, b) => a.top - b.top);
                for (let i = 1; i < column.length; i++) gaps.push(column[i].top - column[i - 1].bottom);
            }
            const inOrder = [...positions].sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left)
                .every(([id], i) => id === i + 1);
            const rect = node.getBoundingClientRect(), foot = footer.getBoundingClientRect();
            grid.querySelector(".cg-card").click();
            container.querySelector(".cg-resource-toggle").click();
            const resourcePanel = container.querySelector(".cg-resources");
            const panelIssues = [];
            const support = container.querySelector(".cg-actions a.cg-support");
            const supportBox = support.getBoundingClientRect();
            if (support.href !== "https://ko-fi.com/light_x02" || support.target !== "_blank" || !support.relList.contains("noopener") ||
                !support.getAttribute("aria-label") || support.tabIndex < 0 || supportBox.width < 24 || supportBox.height < 24 ||
                supportBox.left < container.querySelector(".cg-toggle-render").getBoundingClientRect().right || supportBox.right > rect.right + 1)
                panelIssues.push(["Ko-fi button", supportBox.left, supportBox.right]);
            for (const panel of ["filters", "models", "link", "view", "storage"]) {
                container.querySelector(".cg-tab-" + panel).click();
                if (panel === "storage") {
                    await tick();
                    if (container.querySelector(".cg-folder").value !== "Documents/Hub") panelIssues.push([panel, "default folder label"]);
                    container.querySelector(".cg-folder-browse").click();
                    await tick();
                    if (container.querySelector(".cg-folder-list").hidden) panelIssues.push([panel, "folder browser"]);
                }
                if (panel === "models") {
                    const type = container.querySelector(".cg-model-type"), select = container.querySelector(".cg-model");
                    container.querySelector(".cg-model-query").value = "Moon";
                    type.value = "";
                    type.dispatchEvent(new Event("change"));
                    await tick();
                    const groups = [...select.querySelectorAll("optgroup")].map(group => group.label);
                    type.value = "LORA";
                    type.dispatchEvent(new Event("change"));
                    await tick();
                    if (groups.join("/") !== [t("Checkpoints"), t("LoRAs")].join("/") || select.options.length !== 2 || select.options[1].value !== "12")
                        panelIssues.push([panel, "model types", groups, select.options.length]);
                    for (const [field, feedback] of [[".cg-model-query", ".cg-model-status"], [".cg-model", ".cg-model-count"]]) {
                        const control = container.querySelector(field).getBoundingClientRect();
                        const note = container.querySelector(feedback).getBoundingClientRect();
                        if (Math.abs(note.left - control.left) > 1 || note.top < control.bottom || note.top > control.bottom + 8)
                            panelIssues.push([panel, "feedback location", field, note.left - control.left, note.top - control.bottom]);
                    }
                    if (container.querySelector(".cg-model-count").textContent !== t("1 matching model") ||
                        container.querySelector(".cg-model-status").textContent !== t("Model filter updated.")) panelIssues.push([panel, "feedback text"]);
                }
                const controls = container.querySelectorAll(".cg-panel-" + panel + " :is(input,button,select)");
                for (const el of controls) {
                    if (el.hidden) continue;
                    const box = el.getBoundingClientRect();
                    if (!box.width || box.left < rect.left || box.right > rect.right + 1) panelIssues.push([panel, el.className, box.x, box.width]);
                }
                if (resourcePanel.hidden || scroll.clientHeight < 24 || footer.getBoundingClientRect().bottom > rect.bottom + 1)
                    panelIssues.push([panel, "viewport", scroll.clientHeight, resourcePanel.clientHeight, footer.getBoundingClientRect().bottom - rect.bottom]);
            }
            container.querySelector(".cg-resource-toggle").click();
            container.querySelector(".cg-tab-filters").click();
            measurements.push({ host, language, width, height: outerHeight, count, actual: rect.height, scroll: scroll.scrollTop,
                found: positions.size, columns: columns.size, stable, maxMounted, aspectError, inOrder, panelIssues, minGap: Math.min(...gaps), maxGap: Math.max(...gaps),
                viewport: scroll.clientHeight, footerFits: foot.bottom <= rect.bottom + 1 && foot.top >= scroll.getBoundingClientRect().bottom - 1 });
        }
        const height = host === ".node" ? 450 : 420;
        node.style.width = "720px";
        node.style.setProperty(host === ".node" ? "--node-height" : "height", height + "px");
        resize();
        await tick();
        const tags = container.querySelector(".cg-tags");
        for (const option of [...tags.options].filter(o => o.value).slice(0, 15)) {
            tags.value = option.value;
            tags.dispatchEvent(new Event("change"));
        }
        await tick();
        updateVisibility();
        grid.querySelector(".cg-card").click();
        container.querySelector(".cg-resource-toggle").click();
        const chips = container.querySelector(".cg-tag-chips");
        const boundedTags = chips.scrollHeight > chips.clientHeight && chips.clientHeight > 0;
        const filteredHeight = node.getBoundingClientRect().height, filteredViewport = scroll.clientHeight;
        const summary = container.querySelector(".cg-applied"), toggle = container.querySelector(".cg-applied-toggle");
        toggle.click();
        const detailBox = container.querySelector(".cg-applied-list").getBoundingClientRect();
        const toggleBox = toggle.getBoundingClientRect(), rootBox = container.querySelector(".cg-root").getBoundingClientRect();
        const summaryFits = summary.open && detailBox.height > 0 && detailBox.bottom <= rootBox.bottom + 1 && detailBox.top >= rootBox.top - 1 &&
            (detailBox.top >= toggleBox.bottom - 1 || detailBox.bottom <= toggleBox.top + 1) && scroll.clientHeight === filteredViewport;
        toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const summaryClosed = !summary.open;
        container.querySelector(".cg-tab-link").click();
        container.querySelector(".cg-link-input").value = "https://civitai.com/posts/75";
        container.querySelector(".cg-open-link").click();
        await tick();
        updateVisibility();
        grid.querySelector(".cg-card").click();
        container.querySelector(".cg-resource-toggle").click();
        container.querySelector(".cg-tab-filters").click();
        compact.push({ host, language, count, height, actual: node.getBoundingClientRect().height, viewport: scroll.clientHeight,
            chips: chips.childElementCount, boundedTags, linkedTagsHidden: !chips.clientHeight, filteredHeight, filteredViewport, summaryFits, summaryClosed,
            footerFits: footer.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1,
            linked: !container.querySelector(".cg-link-source").hidden, resources: !container.querySelector(".cg-resources").hidden });
        container.querySelector(".cg-back-gallery").click();
        const sort = container.querySelector(".cg-sort"), shuffle = container.querySelector(".cg-shuffle");
        const fieldText = name => container.querySelector(".cg-" + name).textContent.trim();
        compact.at(-1).labels = [fieldText("tab-filters"), fieldText("prev"), fieldText("next"), fieldText("collections-label")];
        const option = sort.querySelector('option[value="Newest"]');
        compact.at(-1).localized = option.textContent === t("Newest") &&
            container.querySelector(".cg-period").value === "AllTime" &&
            container.querySelector(".cg-refresh").getAttribute("aria-label") === t("Refresh gallery") &&
            container.querySelector(".cg-model-query").placeholder === t("Search by name");
        const initiallyHidden = !shuffle.getBoundingClientRect().width;
        sort.value = "Random";
        sort.dispatchEvent(new Event("change"));
        await tick();
        const bounds = shuffle.getBoundingClientRect(), border = getComputedStyle(shuffle);
        compact.at(-1).shuffle = initiallyHidden && bounds.width > 0 && bounds.left >= node.getBoundingClientRect().left &&
            bounds.right <= node.getBoundingClientRect().right && border.borderTopStyle === "solid" &&
            border.borderTopColor !== "rgba(0, 0, 0, 0)" && shuffle.querySelector("svg").getBoundingClientRect().width > 0;
        updateVisibility();
        grid.querySelector(".cg-card").click();
        const c = name => container.querySelector(".cg-" + name);
        const fitsBody = el => {
            const rect = el.getBoundingClientRect(), body = c("body").getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1 &&
                rect.left >= body.left - 1 && rect.right <= body.right + 1;
        };
        c("detail-toggle").click();
        const before = instance.widgets[0].value;
        c("inspector").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        const browsed = instance.widgets[0].value !== before && c("detail-title").textContent === t("Image #{id}", { id: JSON.parse(instance.widgets[0].value).item.id });
        compact.at(-1).detailChecks = { fits: fitsBody(c("inspector")), notesFit: fitsBody(c("detail-notes")),
            scrolls: c("detail-notes").clientHeight >= 70 && c("detail-notes").scrollHeight > c("detail-notes").clientHeight,
            inert: scroll.inert, browsed };
        if (!compact.at(-1).detailChecks.notesFit) compact.at(-1).detailBounds = ["body", "inspector", "detail-bar", "detail-content", "detail-notes"].map(name => {
            const box = c(name).getBoundingClientRect();
            return [name, box.x, box.y, box.width, box.height];
        });
        c("inspector").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        compact.at(-1).detailChecks.closed = !scroll.inert && document.activeElement === c("detail-toggle");
        c("saved-toggle").click();
        await tick();
        compact.at(-1).saved = fitsBody(c("library")) && !c("library-name").disabled;
        c("library-close").click();
        const collect = grid.querySelector(".cg-collect");
        scroll.scrollTop += collect.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom + 6;
        await tick();
        collect.click();
        await tick();
        const choice = c("collection-choice");
        const popup = c("collection-menu").getBoundingClientRect(), galleryBox = c("root").getBoundingClientRect();
        compact.at(-1).membership = popup.height > 35 && popup.left >= galleryBox.left && popup.right <= galleryBox.right &&
            popup.top >= galleryBox.top && popup.bottom <= galleryBox.bottom && choice?.getAttribute("aria-pressed") === "true" &&
            c("cover-choice").getBoundingClientRect().width > 0;
        if (!compact.at(-1).membership) compact.at(-1).menuBounds = [c("body"), c("collection-menu"), collect, choice]
            .map(el => el && [el.className, el.getAttribute("aria-pressed"), el.getBoundingClientRect().toJSON()]);
        c("collection-menu").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        c("toggle-favonly").click();
        await tick();
        const entry = c("collections-entry"), tile = entry.getBoundingClientRect(), galleryBounds = grid.getBoundingClientRect();
        const slots = [...grid.querySelectorAll(".cg-slot")];
        compact.at(-1).entry = !entry.hidden && grid.firstElementChild === entry &&
            tile.width > 0 && Math.abs(tile.height / tile.width - 1.5) < 0.02 &&
            Math.abs(tile.left - galleryBounds.left) < 1 && Math.abs(tile.top - galleryBounds.top) < 1 &&
            getComputedStyle(entry, "::after").backgroundImage.includes(collectionArt.src) &&
            collectionArt.naturalWidth > 0 && collectionArt.naturalWidth * 3 === collectionArt.naturalHeight * 2 && slots.length > 0 &&
            slots.every(slot => { const rect = slot.getBoundingClientRect(); return rect.left >= tile.right + 11.9 || rect.top >= tile.bottom + 11.9; });
        const label = c("collections-label");
        if (!["en", "fr"].includes(language)) {
            const bounds = label.getBoundingClientRect();
            compact.at(-1).localized &&= getComputedStyle(label).zIndex === "1" && label.scrollWidth <= label.clientWidth + 1 &&
                bounds.top > tile.top + tile.height * .7 && bounds.bottom < tile.bottom;
        }
        entry.click();
        await tick();
        const folder = c("folder-entry").querySelector(".cg-folder-tile"), plate = folder.querySelector(".cg-folder-name");
        const tileBox = folder.getBoundingClientRect(), plusBox = c("new-tile").getBoundingClientRect();
        const labelBox = plate.getBoundingClientRect();
        compact.at(-1).collections = fitsBody(c("explorer")) && c("collection-grid").firstElementChild === c("new-tile") &&
            Math.abs(plusBox.width - tileBox.width) < 1 && Math.abs(plusBox.height - tileBox.height) < 1 &&
            Math.abs(tileBox.height / tileBox.width - 1.5) < 0.02 && plate.textContent === "Reference photos" &&
            Math.abs(labelBox.left + labelBox.width / 2 - tileBox.left - tileBox.width / 2) < 1 &&
            labelBox.top > tileBox.top + tileBox.height / 2 && labelBox.bottom <= tileBox.bottom;
        folder.click();
        await tick();
        const trail = c("collection-path"), parent = c("collections-toggle");
        const crumbBox = trail.getBoundingClientRect(), nameBox = c("current-collection").getBoundingClientRect();
        compact.at(-1).back = entry.hidden && !trail.hidden && !c("collection-parent").hidden && scroll.clientHeight >= 24 &&
            c("current-collection").textContent === "Reference photos" && document.activeElement === parent &&
            nameBox.left > parent.getBoundingClientRect().right && crumbBox.bottom <= scroll.getBoundingClientRect().top + 1;
        parent.click();
        await tick();
        compact.at(-1).back &&= !c("explorer").hidden && c("current-collection").textContent === t("Collections");
        c("explorer-close").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        compact.at(-1).back &&= c("explorer").hidden && document.activeElement === parent;
        c("all-favorites").click();
        await tick();
        compact.at(-1).back &&= !entry.hidden && trail.hidden && document.activeElement === entry;
        gallery.dispose();
        container.replaceChildren();
    }
    node.remove();
}
const widget = buildGalleryView(document, galleryLabels("en"));
widget.style.cssText = "width:720px;height:420px";
document.body.appendChild(widget);
const field = name => widget.querySelector(".cg-" + name);
const photo = (w, h) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"/>');
const preview = photo(80, 120), original = photo(1000, 1500);
const viewer = detailPanel(document, field, () => viewer.show({ id: 77, meta: {} }, { preview, original, video: "" }), () => {},
    { show(el, url) { el.src = url; }, release(el) { el?.removeAttribute("src"); } }, galleryLabels("en"));
field("detail-toggle").hidden = false;
field("detail-toggle").click();
const picture = field("detail-media").querySelector("img");
report.textContent = JSON.stringify({ waiting: "preview" });
await new Promise(done => picture.addEventListener("load", done, { once: true }));
const startsSmall = picture.naturalWidth === 80 && picture.src === preview;
field("detail-enlarge").click();
report.textContent = JSON.stringify({ waiting: "original" });
await new Promise(done => picture.addEventListener("load", done, { once: true }));
const stage = field("detail-media");
const atFullSize = picture.getBoundingClientRect().width === 1000 && stage.scrollWidth > stage.clientWidth && stage.scrollHeight > stage.clientHeight;
field("detail-enlarge").click();
report.textContent = JSON.stringify({ waiting: "restored preview" });
await new Promise(done => picture.addEventListener("load", done, { once: true }));
const zoom = startsSmall && atFullSize && picture.src === preview && !field("detail-notes").hidden;
viewer.close();
widget.remove();
document.querySelector("output").textContent = JSON.stringify({ measurements, compact, zoom });
</script>`);
        const result = spawnSync(browser, ["--headless", "--allow-file-access-from-files", "--disable-gpu", "--disable-background-networking",
            "--no-first-run", "--virtual-time-budget=5000", "--user-data-dir=" + path.join(dir, "profile"), "--dump-dom", pathToFileURL(fixture).href],
        { encoding: "utf8", timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout.match(/<output>([^<]+)<\/output>/)?.[1] || "{}");
        const { measurements: rows, compact, zoom } = report;
        assert.equal(zoom, true, report.error || report.waiting || "Enlarge displays scrollable original pixels");
        assert.equal(compact?.length, 2 * languages.length, "All compact panel scenarios must finish");
        const labels = {
            en: ["Filters", "Previous", "Next", "Collections"], fr: ["Filtres", "Précédent", "Suivant", "Collections"],
            es: ["Filtros", "Anterior", "Siguiente", "Colecciones"], zh: ["筛选", "上一页", "下一页", "收藏集"],
            "zh-TW": ["篩選", "上一頁", "下一頁", "收藏集"], ja: ["フィルター", "前へ", "次へ", "コレクション"],
            ko: ["필터", "이전", "다음", "컬렉션"],
        };
        for (const row of compact) {
            assert.deepEqual(row.labels, labels[row.language], row.language);
            assert.ok(row.localized, JSON.stringify(row));
            assert.ok(Math.abs(row.actual - row.height) <= 1 && row.viewport >= 24 && row.footerFits, JSON.stringify(row));
            assert.ok(Math.abs(row.filteredHeight - row.height) <= 1 && row.filteredViewport >= 24, JSON.stringify(row));
            assert.ok(row.summaryFits && row.summaryClosed, JSON.stringify(row));
            assert.ok(row.shuffle, JSON.stringify(row));
            assert.ok(Object.values(row.detailChecks).every(Boolean) && row.saved && row.collections && row.membership, JSON.stringify(row));
            assert.ok(row.entry && row.back, JSON.stringify(row));
            assert.ok(row.chips === 15 && row.boundedTags && row.linkedTagsHidden && row.linked && row.resources, JSON.stringify(row));
        }
        assert.equal(rows.length, 6 * languages.length);
        for (const row of rows) {
            assert.ok(Math.abs(row.actual - row.height) <= 1 && row.viewport > 0 && row.scroll > 0 && row.footerFits, JSON.stringify(row));
            assert.equal(row.found, row.count, JSON.stringify(row));
            assert.deepEqual(row.panelIssues, [], JSON.stringify(row));
            assert.equal(row.columns, { 1580: 5, 720: 2, 1120: 6 }[row.width], JSON.stringify(row));
            assert.ok(row.aspectError < 0.1, JSON.stringify(row));
            assert.ok(row.stable && row.inOrder && row.minGap >= 11.95 && row.maxGap <= 12.05, JSON.stringify(row));
            if (row.count === 150) assert.ok(row.maxMounted < row.count / 2, JSON.stringify(row));
        }
    } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
});
