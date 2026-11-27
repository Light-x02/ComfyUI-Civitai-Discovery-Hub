import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createHubWidgetRoot } from "../js/gallery-view.js";

const source = readFileSync(new URL("../js/ClearLoraName.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "");

function createDocument() {
    return {
        head: { children: [], appendChild(el) { this.children.push(el); } },
        getElementById(id) { return this.head.children.find(el => el.id === id); },
        createElement() {
            return { classList: new Set(), style: { setProperty(name, value) { this[name] = value; } } };
        },
    };
}

function createNode(document = createDocument()) {
    const button = Object.assign(new EventTarget(), {
        setAttribute(name, value) { this[name] = value; },
    });
    const summary = {};
    class Node {
        buffer = new Float64Array([600, 300]);
        widgets = [{ name: "enabled", value: true }];
        get size() { return this.buffer; }
        set size(value) { this.buffer.set(value); }
        setDirtyCanvas() {}
        addDOMWidget(name, type, root, options) {
            this.root = root;
            root.querySelector = selector => ({ ".cln-toggle": button, ".cln-summary": summary })[selector];
            const widget = { name, options, margin: options.margin ?? 10 };
            this.widgets.push(widget);
            return widget;
        }
    }
    const app = { canvas: {}, registerExtension(ext) { ext.beforeRegisterNodeDef(Node, { name: "ClearLoraName" }); } };
    vm.runInNewContext(source, { app, document, createHubWidgetRoot });
    const node = new Node();
    node.onNodeCreated();
    return { button, node, summary };
}

test("restores the saved boolean and toggles that exact value on the first click", () => {
    const { button, node, summary } = createNode();
    node.widgets[0].value = false;
    node.onConfigure({});
    assert.equal(button.textContent, "Cleaning off");
    assert.match(summary.textContent, /original LoRA tags/);
    assert.equal(button["aria-pressed"], "false");
    const widget = node.widgets[0];
    widget.setValue = function (value, options) {
        assert.equal(options.node, node);
        this.value = value;
        options.node.onWidgetChanged(this.name, value);
    };
    button.dispatchEvent(new Event("click"));
    assert.equal(widget.value, true);
    assert.equal(button.textContent, "Cleaning on");
    assert.equal(button["aria-pressed"], "true");
    assert.match(summary.textContent, /removed/);
    widget.setValue(false, { node });
    assert.equal(button.textContent, "Cleaning off");
});

test("loading the cleaner on its own shares the hub stylesheet across instances", () => {
    const document = createDocument();
    const first = createNode(document);
    const second = createNode(document);
    assert.equal(document.head.children.length, 1);
    assert.equal(document.head.children[0].href, new URL("../js/gallery.css", import.meta.url).href);
    assert.ok(first.node.root.classList.has("civitai-hub-ui"));
    first.button.dispatchEvent(new Event("click"));
    assert.equal(second.button["aria-pressed"], "true");
    assert.match(second.summary.textContent, /removed/);
});

test("accepts typed dimensions, enforces the minimum and keeps instances independent", () => {
    const { node } = createNode();
    assert.deepEqual([...node.size], [600, 300]);
    node.onResize(new Float64Array([720, 360]));
    assert.deepEqual([...node.size], [720, 360]);
    assert.deepEqual([...createNode().node.size], [600, 300]);
    node.onResize(new Float64Array([200, 100]));
    assert.deepEqual([...node.size], [420, 220]);
});

test("the classic overlay follows the current node width after resize and workflow restore", () => {
    const { node } = createNode();
    const widget = node.widgets.find(w => w.name === "clear_lora_name_ui");
    widget.width = 532;
    for (const width of [420, 660, 460]) {
        node.onResize([width, 220]);
        widget.options.onDraw(widget);
        assert.equal(widget.width, width);
        assert.equal(node.root.style["--cln-canvas-width"], (width - 2 * widget.margin) + "px");
    }
    node.size = [420, 220];
    node.onConfigure({});
    widget.options.onDraw(widget);
    assert.equal(widget.width, 420);
    assert.equal(node.root.style["--cln-canvas-width"], "400px");
});
