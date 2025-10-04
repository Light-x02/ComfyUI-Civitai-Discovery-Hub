// Developed by Light - x02
// https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub
import { app } from "/scripts/app.js";

(function () {
    const EXT_NAME = "ClearLoraName.FuturisticTheme";
    const TARGET_CLASSES = ["ClearLoraName"];
    const TARGET_TITLES = [/^\s*🧹?\s*Clear\s+LoRA\s+Name\s*$/i];

    const MIN_W = 420;
    const MIN_H = 220;

    const lsKey = (node) => {
        const name = node?.title || `id${node?.id || "0"}`;
        const klass = node?.comfyClass || "ClearLoraName";
        return `cln:size:${klass}:${name}`;
    };

    const clampSize = (arr) => {
        if (!Array.isArray(arr) || arr.length < 2) return null;
        return [Math.max(MIN_W, +arr[0] || MIN_W), Math.max(MIN_H, +arr[1] || MIN_H)];
    };

    app.registerExtension({
        name: EXT_NAME,

        beforeRegisterNodeDef(nodeType, nodeData) {
            const comfyClass = (nodeType?.comfyClass || "").toString();
            const titleGuess = (nodeData?.name || nodeData?.title || nodeType?.title || "").toString();
            if (!(TARGET_CLASSES.includes(comfyClass) || TARGET_TITLES.some((re) => re.test(titleGuess)))) return;

            const _onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = _onNodeCreated?.apply(this, arguments);
                const node = this;

                node.properties = node.properties || {};
                node.properties.__cln = node.properties.__cln || {};

                if (!node.properties.__cln.themed_once) {
                    node.color = "#000000";
                    node.bgcolor = "#0b0b0b";
                    node.boxcolor = "#1e1e1e";
                    node.title_color = "#ffffff";
                    node.properties.__cln.themed_once = true;
                    node.setDirtyCanvas(true, true);
                }

                node.flags = node.flags || {};
                node.flags.allow_resize = true;
                node.resizable = true;

                let restored =
                    clampSize(node.properties.__cln.saved_size) ||
                    clampSize(JSON.parse(localStorage.getItem(lsKey(node)) || "null")) ||
                    clampSize(node.size) ||
                    [MIN_W, MIN_H];
                node.size = restored;

                if (!node.properties.__cln.dom_once) {
                    const uid = `cln-${Math.random().toString(36).slice(2, 9)}`;
                    const root = document.createElement("div");
                    root.id = uid;
                    root.innerHTML = `
<style>
#${uid}{
  width:100%; height:100%; box-sizing:border-box; color:var(--node-text-color);
  font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
  pointer-events:none;
}
#${uid} .cln-wrap{
  height:100%;
  display:flex; flex-direction:column; gap:8px; border-radius:12px;
  background:
    radial-gradient(1200px 400px at -10% -10%, rgba(57,208,255,.10), transparent 70%),
    radial-gradient(900px 300px at 120% -20%, rgba(106,92,255,.08), transparent 60%);
  border:1px solid rgba(255,255,255,.12); padding:8px 10px; box-sizing:border-box;
  overflow:visible; pointer-events:none;
}
#${uid} .cln-head{
  flex:0 0 auto;
  display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:12px;
  background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.12); box-shadow:0 8px 24px rgba(0,0,0,.35);
  pointer-events:none;
}
#${uid} .dot{width:10px;height:10px;border-radius:50%;
  background:radial-gradient(closest-side,#39d0ff,transparent); box-shadow:0 0 12px #39d0ff}
#${uid} .title{font-weight:700;letter-spacing:.3px}
#${uid} .sub{margin-left:auto;opacity:.75;font-size:12px}
#${uid} .cln-body{
  flex:0 0 auto;
  border:1px solid rgba(255,255,255,.12); border-radius:12px;
  background:linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.015));
  padding:10px 12px; display:flex; align-items:center; box-sizing:border-box;
  pointer-events:none;
}
#${uid} .tips{font-size:12px;opacity:.9;line-height:1.5}
#${uid} .kbd{
  padding:1px 6px; border-radius:6px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.06); font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#${uid} .cln-toggle{
  margin-left:12px; padding:6px 10px; border-radius:10px;
  border:1px solid rgba(255,255,255,.12);
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
  cursor:pointer; user-select:none; font-size:12px;
  pointer-events:auto;
}
#${uid} .cln-toggle.on  { color:#22c55e; border-color:#22c55e66; }
#${uid} .cln-toggle.off { color:#ef4444; border-color:#ef444466; }
</style>
<div class="cln-wrap">
  <div class="cln-head">
    <span class="dot"></span>
    <div class="title">🧹 Clear LoRA Name</div>
    <div class="sub">Neon UI • Clean & minimal</div>
    <button class="cln-toggle">On</button>
  </div>
  <div class="cln-body">
    <div class="tips">
      Removes all <span class="kbd">&lt;lora:...&gt;</span> tags from Positive/Negative prompts.<br/>
      Connect upstream prompts → this node outputs cleaned strings ready for your workflow.
    </div>
  </div>
</div>
          `;

                    const domw = node.addDOMWidget("clear_lora_name_ui", "div", root, {});
                    domw.computeSize = function (w) {
                        const curW = Array.isArray(node.size) ? (node.size[0] ?? MIN_W) : MIN_W;
                        const width = Math.max(MIN_W - 20, (w ?? curW) - 20);
                        const wrap = root.querySelector(".cln-wrap");
                        const EXTRA = 24;
                        let natural = 140;
                        if (wrap) {
                            const prevH = wrap.style.height;
                            wrap.style.height = "auto";
                            natural = Math.ceil(wrap.scrollHeight);
                            wrap.style.height = prevH || "";
                        }
                        const height = Math.max(150, natural + EXTRA);
                        return [width, height];
                    };

                    const saveSize = () => {
                        const sz = clampSize(node.size) || [MIN_W, MIN_H];
                        node.properties.__cln.saved_size = sz; 
                        try {
                            localStorage.setItem(lsKey(node), JSON.stringify(sz)); 
                        } catch { }
                    };

                    const _onResize = node.onResize;
                    node.onResize = function (size) {
                        let s = _onResize ? _onResize.call(this, size) : size;
                        if (!Array.isArray(s) || s.length < 2) s = Array.isArray(size) ? size.slice() : [MIN_W, MIN_H];
                        s[0] = Math.max(MIN_W, s[0] ?? MIN_W);
                        s[1] = Math.max(MIN_H, s[1] ?? MIN_H);
                        node.size = s;
                        saveSize();
                        return s;
                    };

                    const btn = root.querySelector(".cln-toggle");

                    const hideEnabledWidget = () => {
                        const w = node.widgets?.find((ww) => ww.name === "enabled");
                        if (!w) return null;
                        w.draw = function () { };
                        w.computeSize = function () { return [0, -6]; };
                        w.serializeValue = function () { return this.value; };
                        node.setDirtyCanvas(true, true);
                        return w;
                    };
                    let wEnabled = hideEnabledWidget();

                    const refreshEnabledRef = () => {
                        const w = node.widgets?.find((ww) => ww.name === "enabled");
                        if (w && w !== wEnabled) wEnabled = hideEnabledWidget() || w;
                    };

                    const renderBtn = () => {
                        refreshEnabledRef();
                        const on = Boolean(wEnabled?.value ?? true);
                        btn.textContent = on ? "On" : "Off";
                        btn.classList.toggle("on", on);
                        btn.classList.toggle("off", !on);
                    };

                    btn.addEventListener("click", () => {
                        refreshEnabledRef();
                        if (!wEnabled) return;
                        wEnabled.value = !Boolean(wEnabled.value);
                        renderBtn();
                        node.setDirtyCanvas(true, true);
                    });

                    renderBtn();

                    saveSize();

                    node.properties.__cln.dom_once = true;

                    return r;
                }

                return r;
            };
        },
    });
})();

