// ----- SECTION: Imports -----
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

// ----- SECTION: Constants -----
const EXT_NAME = "CivitaiDiscoveryHub.InfiniteScroll";
const DISPLAY_NAME = "🖼️ Civitai Discovery Hub";
const TARGET_CLASS = "CivitaiDiscoveryHubNode";

const USER_TAG_GROUPS = [
    { label: "👤 People", items: [{ name: "👩 Woman", id: "5133" }, { name: "👨 Man", id: "5232" }] },
    { label: "🐾 Animals & Creatures", items: [{ name: "🐾 Animal", id: "111768" }, { name: "🐱 Cat", id: "5132" }, { name: "🐶 Dog", id: "2539" }, { name: "🐉 Dragon", id: "5499" }] },
    { label: "🎨 Styles & Media", items: [{ name: "📷 Photography", id: "5241" }, { name: "🖼️ PhotoRealistic", id: "172" }, { name: "🖌️ Modern art", id: "617" }, { name: "🎎 Anime", id: "4" }, { name: "🎭 Cartoon", id: "5186" }, { name: "📚 Comics", id: "2397" }] },
    { label: "🏞️ Environments & Places", items: [{ name: "🌲 Outdoors", id: "111763" }, { name: "🌄 Landscape", id: "8363" }, { name: "🏙️ City", id: "55" }, { name: "🏛️ Architecture", id: "414" }, { name: "🌌 Astronomy", id: "111767" }] },
    { label: "👗 Clothing & Gear", items: [{ name: "👕 Clothing", id: "5193" }, { name: "🧥 Latex Clothing", id: "111935" }, { name: "🛡️ Armor", id: "5169" }, { name: "🎭 Costume", id: "2435" }] },
    { label: "🚗 Vehicles & Transport", items: [{ name: "🚉 Transportation", id: "111757" }, { name: "🚗 Car", id: "111805" }, { name: "🏎️ Sports Car", id: "111833" }] },
    { label: "🎮 Genres & Characters", items: [{ name: "🎮 Game Character", id: "5211" }, { name: "🐲 Fantasy", id: "5207" }, { name: "👾 Sci-Fi", id: "3060" }, { name: "☣️ Post Apocalyptic", id: "213" }, { name: "🤖 Robot", id: "6594" }] },
    { label: "🍔 Other", items: [{ name: "🍔 Food", id: "3915" }] },
];

// ----- SECTION: Helpers -----
function sanitizeProxyWidgets(props) {
    if (!props || typeof props !== "object" || Array.isArray(props)) return { proxyWidgets: [] };
    if ("proxyWidget" in props && !("proxyWidgets" in props)) {
        props.proxyWidgets = props.proxyWidget;
        delete props.proxyWidget;
    }
    if (!("proxyWidgets" in props)) {
        props.proxyWidgets = [];
        return props;
    }
    const v = props.proxyWidgets;
    if (Array.isArray(v)) return props;
    if (v == null) props.proxyWidgets = [];
    else if (typeof v === "string") {
        const s = v.trim();
        if (!s) props.proxyWidgets = [];
        else if (s.startsWith("[") && s.endsWith("]")) {
            try {
                const arr = JSON.parse(s);
                props.proxyWidgets = Array.isArray(arr) ? arr : [s];
            } catch {
                props.proxyWidgets = [s];
            }
        } else props.proxyWidgets = [s];
    } else props.proxyWidgets = [];
    return props;
}

const qs = (o) =>
    Object.entries(o)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

const getJSON = async (path) => {
    const r = await api.fetchApi(path);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
};

const keyId = (id) => String(id);

function removeSelectionPort(node) {
    try {
        if (!Array.isArray(node.inputs)) return;
        const idx = node.inputs.findIndex((i) => i && i.name === "selection_data");
        if (idx >= 0) node.removeInput(idx);
    } catch { }
}

function hideWidgetDom(widget) {
    try {
        const el = widget?.element || widget?.inputEl || widget?.textarea || widget?.wrapper || widget?.dom || widget?.root;

        if (el && el.style) {
            el.style.display = "none";
            el.style.visibility = "hidden";
            el.style.pointerEvents = "none";
            el.style.height = "0px";
            el.style.width = "0px";
            el.style.opacity = "0";
            el.style.position = "absolute";
            el.style.left = "-99999px";
            el.style.top = "-99999px";
        }

        if (widget?.html && widget.html.style) {
            widget.html.style.display = "none";
            widget.html.style.visibility = "hidden";
            widget.html.style.pointerEvents = "none";
            widget.html.style.height = "0px";
            widget.html.style.width = "0px";
            widget.html.style.opacity = "0";
            widget.html.style.position = "absolute";
            widget.html.style.left = "-99999px";
            widget.html.style.top = "-99999px";
        }
    } catch { }
}

function getOrCreateCGState(node) {
    node.properties = sanitizeProxyWidgets(node.properties || {});
    node.properties.__cg = node.properties.__cg || {};
    return node.properties.__cg;
}

function ensureHiddenSelectionWidget(node) {
    const cg = getOrCreateCGState(node);

    removeSelectionPort(node);

    let wSel = (node.widgets || []).find((w) => w?.name === "selection_data");
    if (!wSel) {
        wSel = node.addWidget(
            "text",
            "selection_data",
            typeof cg.selection_data === "string" ? cg.selection_data : "{}",
            (v) => {
                const s = typeof v === "string" ? v : String(v ?? "{}");
                cg.selection_data = s;
                try {
                    app?.graph?.change?.();
                } catch { }
                try {
                    node?.graph?.change?.();
                } catch { }
                node.setDirtyCanvas(true, true);
            },
            { multiline: true }
        );
    } else {
        const prevCb = wSel.callback;
        wSel.callback = (v) => {
            const s = typeof v === "string" ? v : String(v ?? "{}");
            cg.selection_data = s;
            try {
                prevCb?.(v);
            } catch { }
            try {
                app?.graph?.change?.();
            } catch { }
            try {
                node?.graph?.change?.();
            } catch { }
            node.setDirtyCanvas(true, true);
        };
    }

    wSel.serializeValue = () => (typeof cg.selection_data === "string" ? cg.selection_data : "{}");
    wSel.draw = function () { };
    wSel.computeSize = () => [0, 0];
    hideWidgetDom(wSel);

    if (typeof wSel.value !== "string") wSel.value = typeof cg.selection_data === "string" ? cg.selection_data : "{}";
    return wSel;
}

// ----- SECTION: Register Extension -----
(function () {
    app.registerExtension({
        name: EXT_NAME,

        beforeRegisterNodeDef(nodeType, nodeData) {
            const comfyClass = (nodeType?.comfyClass || nodeData?.name || "").toString();
            if (comfyClass !== TARGET_CLASS) return;

            const _configure = nodeType.prototype.configure;
            nodeType.prototype.configure = function (o, ...rest) {
                if (o && o.properties) o.properties = sanitizeProxyWidgets({ ...o.properties });
                const r = _configure?.call(this, o, ...rest);

                try {
                    removeSelectionPort(this);
                    ensureHiddenSelectionWidget(this);
                } catch { }

                return r;
            };

            const _onSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function (o, ...rest) {
                const out = _onSerialize?.call(this, o, ...rest) ?? o ?? {};
                if (out && out.properties) sanitizeProxyWidgets(out.properties);
                return out;
            };

            const _onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = _onNodeCreated?.apply(this, arguments);
                const node = this;

                node.properties = sanitizeProxyWidgets(node.properties || {});
                const cg = getOrCreateCGState(node);

                if (!cg.colored_once) {
                    node.color = "#000000";
                    node.bgcolor = "#0b0b0b";
                    node.boxcolor = "#1e1e1e";
                    node.title_color = "#ffffff";
                    cg.colored_once = true;
                    node.setDirtyCanvas(true, true);
                }

                removeSelectionPort(node);
                const wSel = ensureHiddenSelectionWidget(node);

                const uid = `cg-${Math.random().toString(36).slice(2, 9)}`;
                const root = document.createElement("div");
                root.id = uid;

                root.innerHTML = `
<style>
#${uid}{height:100%;width:100%;box-sizing:border-box}
#${uid} .cg-root{
  height:100%;display:flex;flex-direction:column;gap:10px;color:var(--node-text-color);
  font-family:ui-sans-serif,system-ui,-apple-system;overflow:hidden;
  --cg-neon:#39d0ff; --cg-neon2:#6a5cff; --cg-chip-bg:rgba(255,255,255,.06);
  --cg-surface:rgba(20,20,30,.55); --cg-border:rgba(255,255,255,.12); --cg-shadow:0 10px 30px rgba(0,0,0,.35);
  background:
    radial-gradient(1200px 400px at -10% -10%, rgba(57,208,255,.10), transparent 70%),
    radial-gradient(900px 300px at 120% -20%, rgba(106,92,255,.08), transparent 60%);
  border-radius:14px;
}
#${uid} .cg-header{position:relative;padding:10px 12px;border-radius:14px;background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02));border:1px solid var(--cg-border);box-shadow:var(--cg-shadow)}
#${uid} .cg-title{display:flex;align-items:center;gap:10px;margin-bottom:8px;letter-spacing:.3px;font-weight:700}
#${uid} .cg-title .dot{width:10px;height:10px;border-radius:50%;background:radial-gradient(closest-side, var(--cg-neon), transparent);box-shadow:0 0 12px var(--cg-neon)}
#${uid} .cg-sub{opacity:.7;font-size:12px}
#${uid} .cg-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
#${uid} .cg-input,#${uid} .cg-select{padding:8px 10px;border:1px solid var(--cg-border);background:var(--cg-surface);color:var(--node-text-color);border-radius:10px;height:32px;backdrop-filter:blur(8px)}
#${uid} .cg-select{appearance:none;background-image:linear-gradient(45deg, transparent 50%, var(--cg-neon) 50%),linear-gradient(135deg, var(--cg-neon) 50%, transparent 50%);background-position:calc(100% - 16px) calc(50% + 3px), calc(100% - 12px) calc(50% + 3px);background-size:6px 6px, 6px 6px;background-repeat:no-repeat;padding-right:26px}
#${uid} .cg-btn{padding:8px 12px;border:1px solid var(--cg-border);background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));border-radius:10px;cursor:pointer;user-select:none;position:relative;overflow:hidden;transition:.18s ease;box-shadow:var(--cg-shadow)}
#${uid} .cg-btn:hover{filter:brightness(1.08)}
#${uid} .cg-btn.toggle.active{box-shadow:0 0 0 1px rgba(57,208,255,.35) inset, 0 0 0 2px rgba(106,92,255,.25) inset, var(--cg-shadow);outline:2px solid var(--cg-neon);outline-offset:0}
#${uid} .cg-scroll{
  flex:1;min-height:0;overflow:auto;border-radius:14px;background:linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
  border:1px solid var(--cg-border);padding:10px;backdrop-filter:blur(4px);box-shadow:var(--cg-shadow);
  overflow-anchor:none;
  overscroll-behavior:contain;
}
#${uid} .cg-scroll::-webkit-scrollbar{width:10px;height:10px}
#${uid} .cg-scroll::-webkit-scrollbar-thumb{background:linear-gradient(var(--cg-neon), var(--cg-neon2));border-radius:10px}
#${uid} .cg-masonry{column-gap:12px;--colw:280px;column-width:var(--colw)}
#${uid} .cg-card{
  display:inline-block;width:100%;margin:0 0 12px;border:1px solid var(--cg-border);border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));position:relative;break-inside:avoid;opacity:0;transform:translateY(6px);
  transition:opacity .18s ease, transform .18s ease, box-shadow .2s ease;box-shadow:var(--cg-shadow);
  overflow-anchor:none;
}
#${uid} .cg-card.show{opacity:1;transform:translateY(0)}
#${uid} .cg-card:hover{box-shadow:0 0 24px rgba(57,208,255,.13), var(--cg-shadow)}
#${uid} .cg-card.selected{outline:2px solid var(--cg-neon);outline-offset:-2px;box-shadow:0 0 28px rgba(57,208,255,.15), var(--cg-shadow)}
#${uid} .cg-img,#${uid} .cg-vid{width:100%;height:auto;display:block;background:#0e0f13}
#${uid} .cg-vid{max-height:72vh}
#${uid} .cg-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px}
#${uid} .cg-meta-left{display:flex;align-items:center;gap:8px}
#${uid} .cg-chip{font-size:11px;background:var(--cg-chip-bg);border:1px solid var(--cg-border);padding:2px 8px;border-radius:999px}
#${uid} .cg-open{font-size:12px;text-decoration:none;border:1px solid var(--cg-border);padding:4px 8px;border-radius:8px;background:var(--cg-surface);color:var(--node-text-color);opacity:.95}
#${uid} .cg-open:hover{opacity:1;filter:brightness(1.08)}
#${uid} .cg-star{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#8b8b8b;transition:.15s}
#${uid} .cg-star:hover{transform:scale(1.06)}
#${uid} .cg-star.fav{color:#ffd970;text-shadow:0 0 8px rgba(255,217,112,.35)}
#${uid} .cg-foot{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:10px;border:1px solid var(--cg-border);border-radius:14px;background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02));box-shadow:var(--cg-shadow)}
#${uid} .cg-status{font-size:12px;opacity:.8}
#${uid} .cg-sentinel{width:100%;height:1px}
#${uid} .cg-toggle-render.cg-render-on{color:#22c55e;border-color:#22c55e66}
#${uid} .cg-toggle-render.cg-render-off{color:#ef4444;border-color:#ef444466}
#${uid} .cg-scroll.paused{display:none !important}
#${uid} .cg-foot.paused{display:none !important}
</style>

<div class="cg-root">
  <div class="cg-header">
    <div class="cg-title"><span class="dot"></span><div>${DISPLAY_NAME}</div><div class="cg-sub">Neon UI • Infinite scroll</div></div>
    <div class="cg-controls">
      <label>NSFW</label>
      <select class="cg-select cg-nsfw">
        <option>None</option><option>Soft</option><option>Mature</option><option>X</option>
      </select>

      <label>Sort</label>
      <select class="cg-select cg-sort">
        <option>Newest</option><option>Most Reactions</option><option>Most Comments</option>
      </select>

      <label>Period</label>
      <select class="cg-select cg-period">
        <option>AllTime</option><option>Year</option><option>Month</option><option>Week</option><option>Day</option>
      </select>

      <label>Tags</label>
      <select class="cg-select cg-tags"><option value="">None</option></select>

      <input class="cg-input cg-username" placeholder="Username">
      <button class="cg-btn cg-search">Apply</button>

      <span style="flex:1"></span>

      <label>Batch</label>
      <select class="cg-select cg-limit">
        <option value="24" selected>24</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="150">150</option>
      </select>

      <button class="cg-btn toggle cg-toggle-video">Videos only</button>
      <button class="cg-btn toggle cg-toggle-noprompt">Hide no-prompt</button>
      <button class="cg-btn toggle cg-toggle-favonly">Favorites only</button>

      <button class="cg-btn cg-refresh">Refresh</button>
      <button class="cg-btn cg-toggle-render cg-render-on">Display: ON</button>
    </div>
  </div>

  <div class="cg-scroll">
    <div class="cg-masonry"></div>
    <div class="cg-sentinel"></div>
  </div>

  <div class="cg-foot">
    <span class="cg-status" style="margin-left:auto"></span>
  </div>
</div>
        `;

                node.addDOMWidget("civitai_gallery", "div", root, {});
                node.size = [1120, 820];

                const MIN_W = 900;
                const MIN_H = 650;

                const $ = (s) => root.querySelector(s);

                const elNSFW = $(".cg-nsfw");
                const elSort = $(".cg-sort");
                const elPeriod = $(".cg-period");
                const elTags = $(".cg-tags");
                const elUser = $(".cg-username");
                const elSearch = $(".cg-search");
                const elRefresh = $(".cg-refresh");
                const elStatus = $(".cg-status");

                const elScroll = root.querySelector(".cg-scroll");
                const elGrid = root.querySelector(".cg-masonry");
                const elSentinel = root.querySelector(".cg-sentinel");

                const elBtnVideo = $(".cg-toggle-video");
                const elBtnNoPrompt = $(".cg-toggle-noprompt");
                const elBtnFavOnly = $(".cg-toggle-favonly");
                const elLimitSel = $(".cg-limit");
                const elBtnRender = $(".cg-toggle-render");

                let loading = false;
                let hasMore = true;
                let favoritesOnly = false;
                let videosOnly = false;
                let hideNoPrompt = false;

                let favoritesMap = {};
                let favoritesArray = [];
                let cursor = null;
                let favOffset = 0;

                let renderEnabled = true;
                let _scrollHandlerBound = null;
                let _ioSentinel = null;
                let _ioVideo = null;

                const LS_RENDER_KEY = `CDH:display:${location.pathname}:${TARGET_CLASS}:${node.id}`;
                const LS_SCROLL_KEY = `CDH:scroll:${location.pathname}:${TARGET_CLASS}:${node.id}`;

                let inView = true;
                let userTouchedThisView = false;
                let autofillArmed = false;

                let restoringScroll = false;
                let _viewRAF = 0;
                let _scrollSaveRAF = 0;

                let lastScrollTop = Number.isFinite(cg.scroll_top) ? cg.scroll_top : 0;

                const setHiddenSelectionPayload = (payloadObj) => {
                    const s = JSON.stringify(payloadObj || {});
                    cg.selection_data = s;
                    if (wSel) wSel.value = s;
                    try {
                        app?.graph?.change?.();
                    } catch { }
                    try {
                        node?.graph?.change?.();
                    } catch { }
                    node.setDirtyCanvas(true, true);
                };

                const isNodeOnScreen = () => {
                    try {
                        const va = app?.canvas?.visible_area || app?.canvas?.ds?.visible_area;
                        if (!va || va.length < 4) return true;

                        const vx = va[0],
                            vy = va[1],
                            vw = va[2],
                            vh = va[3];

                        const nx = node.pos[0],
                            ny = node.pos[1];
                        const nw = node.size[0],
                            nh = node.size[1];

                        return nx + nw > vx && nx < vx + vw && ny + nh > vy && ny < vy + vh;
                    } catch {
                        return true;
                    }
                };

                const getSavedScrollTop = () => {
                    const fromCg = Number.isFinite(cg.scroll_top) ? cg.scroll_top : null;
                    if (fromCg != null) return fromCg;

                    try {
                        const v = parseInt(localStorage.getItem(LS_SCROLL_KEY) || "0", 10);
                        return Number.isFinite(v) ? v : 0;
                    } catch {
                        return 0;
                    }
                };

                const saveScrollTopNow = () => {
                    const v = Number.isFinite(lastScrollTop) ? lastScrollTop : elScroll?.scrollTop ?? 0;
                    cg.scroll_top = v;
                    try {
                        localStorage.setItem(LS_SCROLL_KEY, String(v));
                    } catch { }
                };

                const saveScrollTop = () => {
                    if (_scrollSaveRAF) return;
                    _scrollSaveRAF = requestAnimationFrame(() => {
                        _scrollSaveRAF = 0;
                        saveScrollTopNow();
                    });
                };

                const restoreScrollTop = () => {
                    const v = getSavedScrollTop();
                    lastScrollTop = v;
                    restoringScroll = true;

                    requestAnimationFrame(() => {
                        if (elScroll) elScroll.scrollTop = v;

                        setTimeout(() => {
                            if (elScroll && !userTouchedThisView) elScroll.scrollTop = v;
                            restoringScroll = false;
                        }, 60);
                    });
                };

                const startViewportWatch = () => {
                    const tick = () => {
                        const now = isNodeOnScreen();
                        if (now !== inView) {
                            inView = now;

                            if (!inView) {
                                saveScrollTopNow();
                            } else {
                                userTouchedThisView = false;
                                restoreScrollTop();
                            }
                        }
                        _viewRAF = requestAnimationFrame(tick);
                    };
                    _viewRAF = requestAnimationFrame(tick);
                };

                const stopViewportWatch = () => {
                    try {
                        cancelAnimationFrame(_viewRAF);
                    } catch { }
                    _viewRAF = 0;
                };

                startViewportWatch();

                (function populateTags() {
                    const keep = elTags.value || "";
                    elTags.replaceChildren(new Option("None", ""));
                    for (const group of USER_TAG_GROUPS) {
                        const og = document.createElement("optgroup");
                        og.label = group.label;
                        for (const t of group.items) og.appendChild(new Option(t.name, String(t.id)));
                        elTags.appendChild(og);
                    }
                    if ([...elTags.options].some((o) => o.value === keep)) elTags.value = keep;
                })();

                const loadFavoritesMap = async () => {
                    try {
                        favoritesMap = await getJSON("/civitai_gallery/get_all_favorites_data");
                    } catch {
                        favoritesMap = {};
                    }
                };

                const getItemNsfw = (it) => (typeof it?.nsfwLevel === "string" ? it.nsfwLevel : it?.nsfw ? "X" : "None");

                const isVideo = (it) => {
                    const u = (it?.url || "").toLowerCase();
                    if (u.endsWith(".mp4") || u.endsWith(".webm")) return true;
                    const m = it?.meta || {};
                    const mv = String(m.video || m.videoUrl || m.mp4 || m.mp4Url || "").toLowerCase();
                    return mv.endsWith(".mp4") || mv.endsWith(".webm");
                };

                const civitaiPageUrl = (it) => it.pageUrl || it.postUrl || `https://civitai.com/images/${it.id}`;

                const getPositivePrompt = (it) => it?.meta?.prompt || it?.meta?.Prompt || it?.meta?.positive || it?.meta?.textPrompt || "";

                const hasPositivePrompt = (it) => !!String(getPositivePrompt(it) || "").trim();

                const batchSize = () => {
                    const v = parseInt(elLimitSel.value || "24", 10);
                    if (Number.isNaN(v)) return 24;
                    return Math.min(500, Math.max(12, v));
                };

                const makeUrlStream = (cur) => {
                    const params = {
                        min_batch: batchSize(),
                        cursor: cur || "",
                        sort: elSort.value,
                        period: elPeriod.value,
                        username: elUser.value.trim(),
                        nsfw: elNSFW.value || "None",
                        include_videos: videosOnly ? "true" : "false",
                        videos_only: videosOnly ? "true" : "false",
                        hide_no_prompt: hideNoPrompt ? "true" : "false",
                        time_budget_ms: videosOnly ? "1200" : "",
                    };
                    if (elTags.value) params.tags = elTags.value;
                    return `/civitai_gallery/images_stream?${qs(params)}`;
                };

                const chip = (t) => {
                    const s = document.createElement("span");
                    s.className = "cg-chip";
                    s.textContent = t;
                    return s;
                };

                const posterFromItem = (it) => {
                    const m = it?.meta || {};
                    return (
                        it.thumbnail ||
                        it.preview ||
                        it.cover ||
                        it.coverUrl ||
                        it.previewUrl ||
                        it.image ||
                        m.thumbnail ||
                        m.thumbnailUrl ||
                        m.preview ||
                        m.previewUrl ||
                        m.image ||
                        ""
                    );
                };

                const setStatus = (msg) => {
                    elStatus.textContent = msg || "";
                };

                const matchesVideoMode = (it) => (videosOnly ? isVideo(it) : !isVideo(it));

                const serverFilteredOut = (it) => {
                    if (videosOnly && !isVideo(it)) return true;
                    if (!videosOnly && isVideo(it)) return true;
                    if (hideNoPrompt && !hasPositivePrompt(it)) return true;
                    return false;
                };

                const nearBottom = () => elScroll.scrollHeight - elScroll.scrollTop - elScroll.clientHeight <= 900;

                const setupObservers = () => {
                    _ioVideo = new IntersectionObserver(
                        (entries) => {
                            if (!renderEnabled || !inView) return;

                            for (const e of entries) {
                                const v = e.target;
                                if (!v || v.tagName !== "VIDEO") continue;
                                if (e.isIntersecting) {
                                    if (!v.src && v.dataset.src) {
                                        v.preload = "metadata";
                                        v.src = v.dataset.src;
                                        v.load();

                                        const kickPreview = () => {
                                            try {
                                                const t = v.duration && isFinite(v.duration) ? Math.min(0.1, Math.max(0.02, v.duration * 0.02)) : 0.1;
                                                if (v.readyState < 2) return;
                                                v.currentTime = t;
                                            } catch { }
                                        };

                                        v.addEventListener("loadedmetadata", kickPreview, { once: true });

                                        setTimeout(() => {
                                            if (v.readyState < 2) {
                                                v.preload = "auto";
                                                v.load();
                                                setTimeout(kickPreview, 200);
                                            }
                                        }, 1200);
                                    }
                                }
                            }
                        },
                        { root: elScroll, rootMargin: "1200px" }
                    );

                    _ioSentinel = new IntersectionObserver(
                        (entries) => {
                            if (!renderEnabled || !inView) return;
                            if (restoringScroll) return;
                            if (!autofillArmed && !userTouchedThisView) return;

                            for (const e of entries) {
                                if (e.isIntersecting && !loading && hasMore) loadMore();
                            }
                        },
                        { root: elScroll, rootMargin: "1200px" }
                    );

                    _ioSentinel.observe(elSentinel);
                };

                const makeCard = (it) => {
                    const d = document.createElement("div");
                    d.className = "cg-card";
                    d.dataset.selkey = `image:${keyId(it.id)}`;

                    if (isVideo(it)) {
                        const v = document.createElement("video");
                        v.className = "cg-vid";
                        v.controls = true;
                        v.muted = true;
                        v.playsInline = true;
                        v.preload = "none";
                        const poster = posterFromItem(it);
                        if (poster) v.poster = poster;
                        v.dataset.src = it.url || it?.meta?.videoUrl || it?.meta?.mp4Url || "";

                        const freeze = () => {
                            try {
                                v.pause();
                            } catch { }
                        };
                        v.addEventListener("seeked", freeze);
                        v.addEventListener("loadeddata", freeze, { once: true });

                        _ioVideo?.observe(v);
                        d.appendChild(v);
                    } else {
                        const img = document.createElement("img");
                        img.className = "cg-img";
                        img.loading = "lazy";
                        img.alt = `#${keyId(it.id)}`;
                        img.src = it.url;
                        d.appendChild(img);
                    }

                    const meta = document.createElement("div");
                    meta.className = "cg-meta";

                    const left = document.createElement("div");
                    left.className = "cg-meta-left";
                    left.appendChild(chip(getItemNsfw(it)));
                    left.appendChild(chip(new Date(it.createdAt || Date.now()).toLocaleDateString()));

                    const open = document.createElement("a");
                    open.className = "cg-open";
                    open.href = civitaiPageUrl(it);
                    open.target = "_blank";
                    open.rel = "noopener noreferrer";
                    open.textContent = "Open ↗";
                    open.addEventListener("click", (e) => e.stopPropagation());

                    const star = document.createElement("button");
                    star.className = "cg-star";
                    star.title = "Toggle Favorite";

                    const setStar = (on) => {
                        if (on) {
                            star.classList.add("fav");
                            star.textContent = "★";
                        } else {
                            star.classList.remove("fav");
                            star.textContent = "☆";
                        }
                    };
                    setStar(Boolean(favoritesMap[keyId(it.id)]));

                    star.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        try {
                            const resp = await api.fetchApi("/civitai_gallery/toggle_favorite", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ item: it }),
                            });
                            const data = await resp.json();
                            const k = keyId(it.id);

                            if (data.status === "added") {
                                favoritesMap[k] = it;
                                setStar(true);
                                if (favoritesOnly) await reload(true);
                            } else if (data.status === "removed") {
                                delete favoritesMap[k];
                                setStar(false);
                                if (favoritesOnly) await reload(true);
                            }
                        } catch (err) {
                            console.error("Favorite toggle failed:", err);
                        }
                    });

                    const rightBox = document.createElement("div");
                    rightBox.style.display = "flex";
                    rightBox.style.alignItems = "center";
                    rightBox.style.gap = "8px";
                    rightBox.appendChild(star);
                    rightBox.appendChild(open);

                    meta.appendChild(left);
                    meta.appendChild(rightBox);
                    d.appendChild(meta);

                    d.addEventListener("click", () => selectItem(it, d));
                    requestAnimationFrame(() => d.classList.add("show"));
                    return d;
                };

                const appendGrid = (items) => {
                    const seen = new Set([...elGrid.querySelectorAll(".cg-card")].map((c) => c.dataset.selkey));
                    const nodes = [];
                    for (const it of items) {
                        const key = `image:${keyId(it.id)}`;
                        if (seen.has(key)) continue;
                        const card = makeCard(it);
                        nodes.push(card);
                        seen.add(key);
                    }
                    if (nodes.length) elGrid.append(...nodes);
                };

                const selectItem = (item, cardEl) => {
                    elGrid.querySelectorAll(".cg-card.selected").forEach((c) => c.classList.remove("selected"));
                    cardEl.classList.add("selected");

                    const meta = item.meta || {};
                    const pos = meta.prompt || meta.Prompt || meta.positive || meta.textPrompt || "";
                    const neg = meta.negativePrompt || meta.NegativePrompt || meta.negative || "";

                    const imageOutIdx = 2;
                    const imageConnected = Array.isArray(node.outputs?.[imageOutIdx]?.links) && node.outputs[imageOutIdx].links.length > 0;

                    const payload = {
                        item: { ...item, meta: { ...meta, prompt: pos || meta.prompt || "", negativePrompt: neg || meta.negativePrompt || "" } },
                        download_image: !!imageConnected,
                    };

                    setHiddenSelectionPayload(payload);
                };

                const checkAndAutofill = async () => {
                    if (!renderEnabled || !inView) return;
                    if (!autofillArmed) return;

                    let safety = 6;
                    while (!loading && hasMore && nearBottom() && safety-- > 0) {
                        await loadMore();
                        if (!inView) break;
                    }

                    if (!nearBottom() || !hasMore || safety <= 0) {
                        autofillArmed = false;
                    }
                };

                const loadMoreServer = async () => {
                    if (!renderEnabled || !inView || loading || !hasMore) return;
                    loading = true;
                    setStatus("Loading…");

                    try {
                        const data = await getJSON(makeUrlStream(cursor));
                        const aggregated = Boolean(data?.metadata?.aggregated);

                        let items = Array.isArray(data?.items) ? data.items : [];
                        if (!aggregated) items = items.filter((it) => !serverFilteredOut(it));
                        items = items.filter(matchesVideoMode);

                        appendGrid(items);

                        cursor = data?.metadata?.nextCursor ?? data?.metadata?.cursor ?? data?.metadata?.next ?? null;
                        hasMore = !!cursor && items.length > 0;

                        const ms = data?.metadata?.elapsedMs ?? "?";
                        setStatus(hasMore ? `Loaded ${items.length} • more available (≈${ms}ms)` : `Loaded ${items.length} • end reached (≈${ms}ms)`);
                    } catch (e) {
                        console.error(e);
                        hasMore = false;
                        setStatus(`Error: ${e.message}`);
                    } finally {
                        loading = false;
                        requestAnimationFrame(checkAndAutofill);
                    }
                };

                const applyFavFiltersLocal = (arr) => {
                    let out = arr.slice();
                    out = out.filter(matchesVideoMode);
                    if (hideNoPrompt) out = out.filter((it) => hasPositivePrompt(it));
                    return out;
                };

                const loadMoreFavorites = async () => {
                    if (!renderEnabled || !inView || loading || !hasMore) return;
                    loading = true;
                    setStatus("Loading favorites…");

                    try {
                        if (!favoritesArray.length) {
                            if (!Object.keys(favoritesMap).length) favoritesMap = await getJSON("/civitai_gallery/get_all_favorites_data");
                            favoritesArray = Object.values(favoritesMap || {});
                        }

                        const filtered = applyFavFiltersLocal(favoritesArray);
                        const start = favOffset;
                        const end = favOffset + batchSize();
                        const slice = filtered.slice(start, end);

                        appendGrid(slice);

                        favOffset = end;
                        hasMore = favOffset < filtered.length;

                        setStatus(hasMore ? `Loaded ${slice.length} • ${filtered.length - favOffset} more` : `Loaded ${slice.length} • end reached`);
                    } catch (e) {
                        console.error(e);
                        hasMore = false;
                        setStatus(`Error: ${e.message}`);
                    } finally {
                        loading = false;
                        requestAnimationFrame(checkAndAutofill);
                    }
                };

                const loadMore = async () => {
                    if (!renderEnabled || !inView) return;
                    if (favoritesOnly) return loadMoreFavorites();
                    return loadMoreServer();
                };

                const reload = async (resetToTop) => {
                    if (!renderEnabled || !inView) return;
                    if (loading) return;

                    autofillArmed = true;
                    userTouchedThisView = true;

                    loading = true;
                    setStatus("Loading…");

                    try {
                        favoritesArray = [];
                        favOffset = 0;

                        elGrid.replaceChildren();
                        cursor = null;
                        hasMore = true;

                        if (resetToTop) {
                            lastScrollTop = 0;
                            if (elScroll) elScroll.scrollTop = 0;
                            saveScrollTopNow();
                        } else {
                            restoreScrollTop();
                        }

                        await loadFavoritesMap();
                        favoritesArray = Object.values(favoritesMap || {});

                        await loadMore();
                    } finally {
                        loading = false;
                        requestAnimationFrame(checkAndAutofill);
                    }
                };

                const toggleBtn = (btn, flag) => btn.classList.toggle("active", flag);

                const bindScroll = () => {
                    if (_scrollHandlerBound) return;

                    const markTouched = () => {
                        if (restoringScroll) return;
                        userTouchedThisView = true;
                    };

                    _scrollHandlerBound = () => {
                        if (restoringScroll) return;
                        markTouched();
                        lastScrollTop = elScroll.scrollTop;
                        saveScrollTop();
                        if (nearBottom() && !loading && hasMore && renderEnabled && inView) loadMore();
                    };

                    elScroll.addEventListener("scroll", _scrollHandlerBound, { passive: true });
                    elScroll.addEventListener("wheel", markTouched, { passive: true });
                    elScroll.addEventListener("pointerdown", markTouched, { passive: true });
                };

                const unbindScroll = () => {
                    if (!_scrollHandlerBound) return;
                    elScroll.removeEventListener("scroll", _scrollHandlerBound);
                    _scrollHandlerBound = null;
                };

                const setRenderState = async (on) => {
                    renderEnabled = !!on;

                    try {
                        localStorage.setItem(LS_RENDER_KEY, renderEnabled ? "1" : "0");
                    } catch { }

                    try {
                        cg.display_on = renderEnabled;
                    } catch { }

                    elBtnRender.classList.toggle("cg-render-on", renderEnabled);
                    elBtnRender.classList.toggle("cg-render-off", !renderEnabled);
                    elBtnRender.textContent = renderEnabled ? "Display: ON" : "Display: OFF";

                    elScroll.classList.toggle("paused", !renderEnabled);
                    root.querySelector(".cg-foot")?.classList.toggle("paused", !renderEnabled);

                    if (!renderEnabled) {
                        saveScrollTopNow();

                        try {
                            _ioSentinel?.disconnect();
                        } catch { }
                        try {
                            _ioVideo?.disconnect();
                        } catch { }

                        unbindScroll();

                        elGrid.querySelectorAll("video").forEach((v) => {
                            try {
                                v.pause();
                            } catch { }
                        });

                        setStatus("");
                        return;
                    }

                    setupObservers();
                    bindScroll();
                    restoreScrollTop();

                    if (!cg.has_loaded_once) {
                        cg.has_loaded_once = true;
                        await reload(true);
                    }
                };

                node.onResize = function (size) {
                    if (size[0] < MIN_W) size[0] = MIN_W;
                    if (size[1] < MIN_H) size[1] = MIN_H;
                    requestAnimationFrame(checkAndAutofill);
                    return size;
                };

                [elNSFW, elSort, elPeriod, elLimitSel].forEach((x) => x.addEventListener("change", () => reload(true)));
                elTags.addEventListener("change", () => reload(true));
                elRefresh.addEventListener("click", () => reload(true));
                elSearch.addEventListener("click", () => reload(true));
                elUser.addEventListener("keydown", (e) => e.key === "Enter" && reload(true));

                elBtnVideo.addEventListener("click", () => {
                    videosOnly = !videosOnly;
                    toggleBtn(elBtnVideo, videosOnly);
                    reload(true);
                });

                elBtnNoPrompt.addEventListener("click", () => {
                    hideNoPrompt = !hideNoPrompt;
                    toggleBtn(elBtnNoPrompt, hideNoPrompt);
                    reload(true);
                });

                elBtnFavOnly.addEventListener("click", async () => {
                    favoritesOnly = !favoritesOnly;
                    toggleBtn(elBtnFavOnly, favoritesOnly);
                    await reload(true);
                });

                elBtnRender.addEventListener("click", () => setRenderState(!renderEnabled));

                const ro = new ResizeObserver(() => {
                    const w = elScroll.clientWidth || root.clientWidth || 900;
                    const target = Math.max(240, Math.min(360, Math.floor(w / Math.ceil(w / 280))));
                    elGrid.style.setProperty("--colw", `${target}px`);
                    requestAnimationFrame(checkAndAutofill);
                });
                ro.observe(elScroll);

                const _prevOnRemoved = node.onRemoved;
                node.onRemoved = function () {
                    saveScrollTopNow();
                    stopViewportWatch();
                    try {
                        _ioSentinel?.disconnect();
                    } catch { }
                    try {
                        _ioVideo?.disconnect();
                    } catch { }
                    try {
                        ro?.disconnect();
                    } catch { }
                    try {
                        unbindScroll();
                    } catch { }
                    return _prevOnRemoved?.apply(this, arguments);
                };

                (async () => {
                    toggleBtn(elBtnVideo, videosOnly);
                    toggleBtn(elBtnNoPrompt, hideNoPrompt);
                    toggleBtn(elBtnFavOnly, favoritesOnly);
                    setStatus("");

                    let saved = null;
                    try {
                        saved = localStorage.getItem(LS_RENDER_KEY);
                    } catch { }

                    const propVal = typeof cg.display_on === "boolean" ? cg.display_on : null;
                    const initOn = saved == null ? (propVal == null ? true : propVal) : saved === "1";

                    await setRenderState(initOn);
                })();

                return r;
            };
        },
    });
})();
