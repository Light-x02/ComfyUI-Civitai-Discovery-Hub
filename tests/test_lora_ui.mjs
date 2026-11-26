import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../js/ClearLoraName.js", import.meta.url), "utf8")
    .replace(/^import .*;$/m, "");

function createNode() {
    const button = Object.assign(new EventTarget(), {
        classList: { toggle() {} },
        setAttribute(name, value) { this[name] = value; },
    });
    class Node {
        buffer = new Float64Array([600, 300]);
        widgets = [{ name: "enabled", value: true }];
        get size() { return this.buffer; }
        set size(value) { this.buffer.set(value); }
        setDirtyCanvas() {}
        addDOMWidget(name) {
            const widget = { name };
            this.widgets.push(widget);
            return widget;
        }
    }
    const app = { canvas: {}, registerExtension(ext) { ext.beforeRegisterNodeDef(Node, { name: "ClearLoraName" }); } };
    const document = { createElement() { return { querySelector: () => button }; } };
    vm.runInNewContext(source, { app, document });
    const node = new Node();
    node.onNodeCreated();
    return { button, node };
}

test("restores the saved boolean and toggles that exact value on the first click", () => {
    const { button, node } = createNode();
    node.widgets[0].value = false;
    node.onConfigure({});
    assert.equal(button.textContent, "Off");
    assert.equal(button["aria-pressed"], "false");
    const widget = node.widgets[0];
    widget.setValue = function (value, options) {
        assert.equal(options.node, node);
        this.value = value;
        options.node.onWidgetChanged(this.name, value);
    };
    button.dispatchEvent(new Event("click"));
    assert.equal(widget.value, true);
    assert.equal(button.textContent, "On");
    widget.setValue(false, { node });
    assert.equal(button.textContent, "Off");
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
