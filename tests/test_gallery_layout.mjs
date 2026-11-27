import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        const view = readFileSync(new URL("../js/gallery-view.js", import.meta.url), "utf8");
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
<div class="classic"></div><output></output>
<script type="module">
${view}
const app = { registerExtension() {} };
${controller}
let items;
const api = { async fetchApi(path) {
    const data = path.endsWith("/get_favorite_ids") ? { ids: [] } :
        path.includes("cursor=second") ? { items, metadata: {} } : { items: [{ id: 999 }], metadata: { nextCursor: "second" } };
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
let resize;
class ResizeObserver {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() {}
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const measurements = [];
for (const [host, mount] of [[".node", ".mount"], [".classic", ".classic"]]) {
    const node = document.querySelector(host);
    const container = document.querySelector(mount);
    for (const count of [24, 150]) {
        items = Array.from({length: count}, (_, i) => ({
            id: i + 1, width: 800, height: [1200, 460, 1600, 900, 640, 1040, 800][i % 7], type: "image",
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
            measurements.push({ host, width, height: outerHeight, count, actual: rect.height, scroll: scroll.scrollTop,
                found: positions.size, columns: columns.size, stable, maxMounted, aspectError, inOrder, minGap: Math.min(...gaps), maxGap: Math.max(...gaps),
                viewport: scroll.clientHeight, footerFits: foot.bottom <= rect.bottom + 1 && foot.top >= scroll.getBoundingClientRect().bottom - 1 });
        }
        gallery.dispose();
        container.replaceChildren();
    }
    node.remove();
}
document.querySelector("output").textContent = JSON.stringify(measurements);
</script>`);
        const result = spawnSync(browser, ["--headless", "--disable-gpu", "--disable-background-networking",
            "--no-first-run", "--virtual-time-budget=5000", "--user-data-dir=" + path.join(dir, "profile"), "--dump-dom", pathToFileURL(fixture).href],
        { encoding: "utf8", timeout: 30000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        const rows = JSON.parse(result.stdout.match(/<output>([^<]+)<\/output>/)?.[1] || "[]");
        assert.equal(rows.length, 12);
        for (const row of rows) {
            assert.ok(Math.abs(row.actual - row.height) <= 1 && row.viewport > 0 && row.scroll > 0 && row.footerFits, JSON.stringify(row));
            assert.equal(row.found, row.count, JSON.stringify(row));
            assert.equal(row.columns, { 1580: 5, 720: 2, 1120: 6 }[row.width], JSON.stringify(row));
            assert.ok(row.aspectError < 0.1, JSON.stringify(row));
            assert.ok(row.stable && row.inOrder && row.minGap >= 11.95 && row.maxGap <= 12.05, JSON.stringify(row));
            if (row.count === 150) assert.ok(row.maxMounted < row.count / 2, JSON.stringify(row));
        }
    } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
});
