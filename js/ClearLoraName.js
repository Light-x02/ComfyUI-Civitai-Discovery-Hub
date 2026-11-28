// Developed by Light-x02
// https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub

// ----- SECTION: Imports -----
import { app } from "/scripts/app.js";
import { createHubWidgetRoot } from "./gallery-view.js";
import { galleryLabels, hubLanguage, loadHubLanguage } from "./hub-i18n.js";

(function () {
    const EXT_NAME = "ClearLoraName.FuturisticTheme";
    const TARGET_CLASSES = ["ClearLoraName"];
    const TARGET_TITLES = [/^\s*🧹?\s*Clear\s+LoRA\s+Name\s*$/i];

    const MIN_W = 420;
    const MIN_H = 220;

    const clampSize = (size) => [
        Math.max(MIN_W, size?.[0] || 0),
        Math.max(MIN_H, size?.[1] || 0),
    ];

    app.registerExtension({
        name: EXT_NAME,

        beforeConfigureGraph() { return loadHubLanguage(app, document); },
        beforeRegisterNodeDef(nodeType, nodeData) {
            const comfyClass = (nodeType?.comfyClass || nodeData?.name || "").toString();
            const titleGuess = (nodeData?.name || nodeData?.title || nodeType?.title || "").toString();

            if (!(TARGET_CLASSES.includes(comfyClass) || TARGET_TITLES.some((re) => re.test(titleGuess)))) return;

            const _onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = _onNodeCreated?.apply(this, arguments);
                const node = this;

                if (node.widgets?.some((w) => w.name === "clear_lora_name_ui")) return r;

                node.color = "#000000";
                node.bgcolor = "#0b0b0b";
                node.boxcolor = "#1e1e1e";
                node.title_color = "#ffffff";
                node.flags = node.flags || {};
                node.flags.allow_resize = true;
                node.resizable = true;
                node.size = clampSize(node.size);

                const root = createHubWidgetRoot(document);
                root.lang = hubLanguage(app, document);
                const t = galleryLabels(root.lang);
                root.classList.add("cln-widget");
                root.innerHTML = `
<div class="cg-root">
  <header class="cg-bar">
    <div class="cg-brand"><span class="cg-mark" aria-hidden="true"><i></i><i></i><i></i></span>${t("Clear LoRA Name")}</div>
    <div class="cg-actions">
      <button type="button" class="cg-btn cg-toggle-render cln-toggle" aria-label="${t("Remove LoRA tags")}"></button>
    </div>
  </header>
  <p class="cln-summary"></p>
</div>`;

                node.addDOMWidget("clear_lora_name_ui", "div", root, {
                    serialize: false,
                    getMinHeight: () => 134,
                    getMaxHeight: () => 134,
                    onDraw(widget) {
                        // The classic canvas positions DOM widgets in a separate overlay.
                        const width = node.size[0];
                        if (widget.width === width) return;
                        widget.width = width;
                        root.style.setProperty("--cln-canvas-width", (width - 2 * widget.margin) + "px");
                    },
                });

                const _onResize = node.onResize;
                node.onResize = function (size) {
                    const requested = _onResize?.call(this, size) || size;
                    const next = clampSize(requested);
                    if (node.size[0] !== next[0] || node.size[1] !== next[1]) node.size = next;
                    return next;
                };

                const btn = root.querySelector(".cln-toggle");
                const summary = root.querySelector(".cln-summary");

                const hideEnabledWidget = () => {
                    const w = node.widgets?.find((ww) => ww.name === "enabled");
                    if (!w) return null;
                    w.hidden = true;
                    w.draw = function () { };
                    w.computeSize = function () { return [0, 0]; };
                    node.setDirtyCanvas(true, true);
                    return w;
                };

                let wEnabled = hideEnabledWidget();

                const refreshEnabledRef = () => {
                    const w = node.widgets?.find((ww) => ww.name === "enabled");
                    if (w !== wEnabled) wEnabled = hideEnabledWidget();
                };

                const renderBtn = () => {
                    refreshEnabledRef();
                    btn.disabled = !wEnabled;
                    const on = Boolean(wEnabled?.value ?? true);
                    btn.textContent = t(on ? "Cleaning on" : "Cleaning off");
                    btn.setAttribute("aria-pressed", String(on));
                    summary.textContent = t(on
                        ? "LoRA tags are removed from both positive and negative prompts."
                        : "Both prompts pass through with their original LoRA tags.");
                };

                btn.addEventListener("click", (event) => {
                    refreshEnabledRef();
                    if (!wEnabled) return;
                    node.graph?.beforeChange();
                    const value = !Boolean(wEnabled.value);
                    if (wEnabled.setValue && app.canvas) {
                        wEnabled.setValue(value, { e: event, node, canvas: app.canvas });
                    } else {
                        wEnabled.value = value;
                        wEnabled.callback?.(value);
                    }
                    node.graph?.afterChange();
                    renderBtn();
                    node.setDirtyCanvas(true, true);
                });

                const _onWidgetChanged = node.onWidgetChanged;
                node.onWidgetChanged = function (name, ...args) {
                    const result = _onWidgetChanged?.call(this, name, ...args);
                    if (name === "enabled") renderBtn();
                    return result;
                };

                const _onConfigure = node.onConfigure;
                node.onConfigure = function (...args) {
                    const result = _onConfigure?.apply(this, args);
                    renderBtn();
                    return result;
                };
                renderBtn();

                return r;
            };
            return loadHubLanguage(app, document);
        },
    });
})();
