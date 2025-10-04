// Developed by Light - x02
// https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

(function () {
    const EXT_NAME = "CivitaiDiscoveryHub.InfiniteScroll";
    const DISPLAY_NAME = "🖼️ Civitai Discovery Hub";

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

    app.registerExtension({
        name: EXT_NAME,
        beforeRegisterNodeDef(nodeType, nodeData) {
            const title = nodeData?.name || nodeData?.title || nodeType?.title || "";
            const typeName = (nodeType?.comfyClass || nodeData?.name || "").toString();
            const matchesTitle = /civitai/i.test(title) && /(gallery|discovery\s*hub)/i.test(title);
            const matchesType = /(CivitaiDiscoveryHubNode|CivitaiGalleryNode)/.test(typeName);
            if (!(matchesTitle || matchesType)) return;

            const _onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = _onNodeCreated?.apply(this, arguments);
                const node = this;
                node.properties = node.properties || {};
                node.properties.__cg = node.properties.__cg || {};

                // Thème
                if (!node.properties.__cg.colored_once) {
                    node.color = "#000000";
                    node.bgcolor = "#0b0b0b";
                    node.boxcolor = "#1e1e1e";
                    node.title_color = "#ffffff";
                    node.properties.__cg.colored_once = true;
                    node.setDirtyCanvas(true, true);
                }

                // Widget caché (data -> Python)
                const wSel = node.addWidget("text", "selection_data", node.properties.__cg.selection_data || "{}", () => { }, { multiline: true });
                wSel.serializeValue = () => node.properties.__cg.selection_data || "{}";
                wSel.draw = function () { };
                wSel.computeSize = () => [0, -4];

                // DOM
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
#${uid} .cg-header{
  position:relative; padding:10px 12px; border-radius:14px;
  background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
  border:1px solid var(--cg-border); box-shadow: var(--cg-shadow);
}
#${uid} .cg-title{ display:flex; align-items:center; gap:10px; margin-bottom:8px; letter-spacing:.3px; font-weight:700; }
#${uid} .cg-title .dot{ width:10px;height:10px;border-radius:50%; background: radial-gradient(closest-side, var(--cg-neon), transparent); box-shadow: 0 0 12px var(--cg-neon); }
#${uid} .cg-sub{opacity:.7; font-size:12px}
#${uid} .cg-controls{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; }
#${uid} .cg-input,#${uid} .cg-select{
  padding:8px 10px; border:1px solid var(--cg-border); background:var(--cg-surface); color:var(--node-text-color);
  border-radius:10px; height:32px; backdrop-filter: blur(8px);
}
#${uid} .cg-select{appearance:none; background-image:
  linear-gradient(45deg, transparent 50%, var(--cg-neon) 50%),
  linear-gradient(135deg, var(--cg-neon) 50%, transparent 50%);
  background-position: calc(100% - 16px) calc(50% + 3px), calc(100% - 12px) calc(50% + 3px);
  background-size: 6px 6px, 6px 6px; background-repeat: no-repeat; padding-right: 26px; }
#${uid} .cg-btn{ padding:8px 12px; border:1px solid var(--cg-border);
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); border-radius:10px; cursor:pointer; user-select:none;
  position:relative; overflow:hidden; transition: .18s ease; box-shadow: var(--cg-shadow);
}
#${uid} .cg-btn:hover{ filter:brightness(1.08) }
#${uid} .cg-btn.toggle.active{
  box-shadow: 0 0 0 1px rgba(57,208,255,.35) inset, 0 0 0 2px rgba(106,92,255,.25) inset, var(--cg-shadow);
  outline:2px solid var(--cg-neon); outline-offset:0;
}
#${uid} .cg-scroll{
  flex:1; min-height:0; overflow:auto; border-radius:14px;
  background:linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
  border:1px solid var(--cg-border); padding:10px; backdrop-filter: blur(4px); box-shadow: var(--cg-shadow);
}
#${uid} .cg-scroll::-webkit-scrollbar{ width:10px; height:10px }
#${uid} .cg-scroll::-webkit-scrollbar-thumb{ background: linear-gradient(var(--cg-neon), var(--cg-neon2)); border-radius:10px }
#${uid} .cg-masonry{ column-gap:12px; --colw:280px; column-width:var(--colw) }
#${uid} .cg-card{
  display:inline-block; width:100%; margin:0 0 12px; border:1px solid var(--cg-border); border-radius:14px; overflow:hidden;
  background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)); position:relative; break-inside:avoid; opacity:0; transform:translateY(6px);
  transition:opacity .18s ease, transform .18s ease, box-shadow .2s ease; box-shadow: var(--cg-shadow);
}
#${uid} .cg-card.show{ opacity:1; transform:translateY(0) }
#${uid} .cg-card:hover{ box-shadow: 0 0 24px rgba(57,208,255,.13), var(--cg-shadow) }
#${uid} .cg-card.selected{ outline:2px solid var(--cg-neon); outline-offset:-2px; box-shadow: 0 0 28px rgba(57,208,255,.15), var(--cg-shadow) }
#${uid} .cg-img,#${uid} .cg-vid{ width:100%; height:auto; display:block; background:#0e0f13 }
#${uid} .cg-vid{ max-height:72vh }
#${uid} .cg-meta{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px }
#${uid} .cg-meta-left{ display:flex; align-items:center; gap:8px }
#${uid} .cg-chip{ font-size:11px; background:var(--cg-chip-bg); border:1px solid var(--cg-border); padding:2px 8px; border-radius:999px }
#${uid} .cg-open{ font-size:12px; text-decoration:none; border:1px solid var(--cg-border); padding:4px 8px; border-radius:8px; background:var(--cg-surface); color:var(--node-text-color); opacity:.95 }
#${uid} .cg-open:hover{ opacity:1; filter:brightness(1.08) }
#${uid} .cg-star{ border:none; background:transparent; font-size:20px; line-height:1; cursor:pointer; color:#8b8b8b; transition:.15s }
#${uid} .cg-star:hover{ transform:scale(1.06) }
#${uid} .cg-star.fav{ color:#ffd970; text-shadow:0 0 8px rgba(255,217,112,.35) }
#${uid} .cg-foot{ display:flex; align-items:center; gap:10px; flex-shrink:0; padding:10px; border:1px solid var(--cg-border); border-radius:14px;
  background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); box-shadow: var(--cg-shadow); }
#${uid} .cg-status{ font-size:12px; opacity:.8 }
#${uid} .cg-hidden{ display:none !important }
#${uid} .cg-sentinel{ width:100%; height:1px }

/* Display ON/OFF */
#${uid} .cg-toggle-render.cg-render-on  { color:#22c55e; border-color:#22c55e66; }
#${uid} .cg-toggle-render.cg-render-off { color:#ef4444; border-color:#ef444466; }
#${uid} .cg-scroll.paused { display:none !important; }
#${uid} .cg-foot.paused   { display:none !important; }
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
                const MIN_W = 900, MIN_H = 650;
                node.onResize = function (size) {
                    if (size[0] < MIN_W) size[0] = MIN_W;
                    if (size[1] < MIN_H) size[1] = MIN_H;
                    requestAnimationFrame(checkAndAutofill);
                    return size;
                };

                // refs
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
                const elBtnVideo = $(".cg-toggle-video");
                const elBtnNoPrompt = $(".cg-toggle-noprompt");
                const elBtnFavOnly = $(".cg-toggle-favonly");
                const elLimitSel = $(".cg-limit");
                const elSentinel = root.querySelector(".cg-sentinel");
                const elBtnRender = $(".cg-toggle-render");

                // state
                let loading = false;
                let hasMore = true;
                let favoritesOnly = false;
                let videosOnly = false;
                let hideNoPrompt = false;
                let favoritesMap = {};
                let favoritesArray = [];
                let lastKey = "";
                let cursor = null;
                let favOffset = 0;

                // Display ON/OFF state & infra
                let renderEnabled = true;
                let _scrollHandlerBound = null;
                let _ioSentinel = null;
                let _ioVideo = null;

                const NEAR_BOTTOM_PX = 900;

                // Tags
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
                    try { favoritesMap = await getJSON("/civitai_gallery/get_all_favorites_data"); }
                    catch { favoritesMap = {}; }
                };

                // helpers
                const getItemNsfw = (it) => (typeof it?.nsfwLevel === "string" ? it.nsfwLevel : (it?.nsfw ? "X" : "None"));
                const isVideo = (it) => {
                    const u = (it?.url || "").toLowerCase();
                    if (u.endsWith(".mp4") || u.endsWith(".webm")) return true;
                    const m = it?.meta || {};
                    const mv = String(m.video || m.videoUrl || m.mp4 || m.mp4Url || "").toLowerCase();
                    return mv.endsWith(".mp4") || mv.endsWith(".webm");
                };
                const civitaiPageUrl = (it) => it.pageUrl || it.postUrl || `https://civitai.com/images/${it.id}`;
                const getPositivePrompt = (it) => (it?.meta?.prompt || it?.meta?.Prompt || it?.meta?.positive || it?.meta?.textPrompt || "");
                const hasPositivePrompt = (it) => !!String(getPositivePrompt(it) || "").trim();

                const batchSize = () => {
                    const v = parseInt(elLimitSel.value || "24", 10);
                    if (Number.isNaN(v)) return 24;
                    return Math.min(500, Math.max(12, v));
                };

                const buildKey = () =>
                    [
                        elNSFW.value,
                        elSort.value,
                        elPeriod.value,
                        elTags.value || "",
                        elUser.value.trim(),
                        videosOnly ? "vo1" : "vo0",
                        hideNoPrompt ? "np1" : "np0",
                        favoritesOnly ? "fav1" : "fav0",
                        `B${batchSize()}`,
                    ].join("|");

                // URL serveur (cursor)
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

                // chips
                const chip = (t) => {
                    const s = document.createElement("span");
                    s.className = "cg-chip";
                    s.textContent = t;
                    return s;
                };

                // ---------- Lazy <video> + poster + first-frame ----------
                const posterFromItem = (it) => {
                    const m = it?.meta || {};
                    return (
                        it.thumbnail || it.preview || it.cover || it.coverUrl || it.previewUrl || it.image ||
                        m.thumbnail || m.thumbnailUrl || m.preview || m.previewUrl || m.image || ""
                    );
                };

                // Observers factory (vid + sentinel)
                const setupObservers = () => {
                    // Video observer
                    _ioVideo = new IntersectionObserver(
                        (entries) => {
                            if (!renderEnabled) return;
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
                                                const t = v.duration && isFinite(v.duration)
                                                    ? Math.min(0.1, Math.max(0.02, v.duration * 0.02))
                                                    : 0.1;
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

                    // Sentinel observer
                    _ioSentinel = new IntersectionObserver(
                        (entries) => {
                            if (!renderEnabled) return;
                            for (const e of entries) {
                                if (e.isIntersecting && !loading && hasMore) loadMore();
                            }
                        },
                        { root: elScroll, rootMargin: "1200px" }
                    );
                    _ioSentinel.observe(elSentinel);
                };

                // card
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

                        const freeze = () => { try { v.pause(); } catch { } };
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
                        if (on) { star.classList.add("fav"); star.textContent = "★"; }
                        else { star.classList.remove("fav"); star.textContent = "☆"; }
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
                                if (favoritesOnly) await reload();
                            } else if (data.status === "removed") {
                                delete favoritesMap[k];
                                setStar(false);
                                if (favoritesOnly) await reload();
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

                // render
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
                    const payload = { item: { ...item, meta: { ...meta, prompt: pos || meta.prompt || "", negativePrompt: neg || meta.negativePrompt || "" } }, download_image: !!imageConnected };
                    node.properties.__cg.selection_data = JSON.stringify(payload);
                    const w = node.widgets?.find((w) => w.name === "selection_data");
                    if (w) w.value = node.properties.__cg.selection_data;
                    node.setDirtyCanvas(true, true);
                };

                const setStatus = (msg) => (elStatus.textContent = msg || "");

                const matchesVideoMode = (it) => (videosOnly ? isVideo(it) : !isVideo(it));

                const serverFilteredOut = (it) => {
                    if (videosOnly && !isVideo(it)) return true;
                    if (!videosOnly && isVideo(it)) return true;
                    if (hideNoPrompt && !hasPositivePrompt(it)) return true;
                    return false;
                };

                // near-bottom
                const nearBottom = () => (elScroll.scrollHeight - elScroll.scrollTop - elScroll.clientHeight) <= NEAR_BOTTOM_PX;

                // === Guards with renderEnabled ===
                const checkAndAutofill = async () => {
                    if (!renderEnabled) return;
                    let safety = 6;
                    while (!loading && hasMore && nearBottom() && safety-- > 0) {
                        await loadMore();
                    }
                };

                const loadMoreServer = async () => {
                    if (!renderEnabled || loading || !hasMore) return;
                    loading = true;
                    setStatus("Loading…");
                    try {
                        const data = await getJSON(makeUrlStream(cursor));
                        const aggregated = Boolean(data?.metadata?.aggregated);
                        let items = Array.isArray(data?.items) ? data.items : [];
                        if (!aggregated) items = items.filter((it) => !serverFilteredOut(it));
                        items = items.filter(matchesVideoMode);
                        appendGrid(items);

                        cursor =
                            data?.metadata?.nextCursor ??
                            data?.metadata?.cursor ??
                            data?.metadata?.next ??
                            null;

                        hasMore = !!cursor && items.length > 0;
                        setStatus(
                            hasMore
                                ? `Loaded ${items.length} • more available (≈${data?.metadata?.elapsedMs ?? "?"}ms)`
                                : `Loaded ${items.length} • end reached (≈${data?.metadata?.elapsedMs ?? "?"}ms)`
                        );
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
                    if (!renderEnabled || loading || !hasMore) return;
                    loading = true;
                    setStatus("Loading favorites…");
                    try {
                        if (!favoritesArray.length) {
                            if (!Object.keys(favoritesMap).length) {
                                favoritesMap = await getJSON("/civitai_gallery/get_all_favorites_data");
                            }
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
                    if (!renderEnabled) return;
                    if (favoritesOnly) return loadMoreFavorites();
                    return loadMoreServer();
                };

                const reload = async () => {
                    if (!renderEnabled) return;
                    if (loading) return;
                    loading = true;
                    setStatus("Loading…");
                    try {
                        const key = buildKey();
                        if (key !== lastKey) lastKey = key;

                        favoritesArray = [];
                        favOffset = 0;

                        elGrid.replaceChildren();
                        cursor = null;
                        hasMore = true;

                        await loadFavoritesMap();
                        favoritesArray = Object.values(favoritesMap || {});

                        await loadMore();
                    } finally {
                        loading = false;
                        requestAnimationFrame(checkAndAutofill);
                    }
                };

                [elNSFW, elSort, elPeriod, elLimitSel].forEach((x) => x.addEventListener("change", reload));
                elTags.addEventListener("change", reload);
                elRefresh.addEventListener("click", reload);
                elSearch.addEventListener("click", reload);
                elUser.addEventListener("keydown", (e) => e.key === "Enter" && reload());

                const toggleBtn = (btn, flag) => btn.classList.toggle("active", flag);

                elBtnVideo.addEventListener("click", () => {
                    videosOnly = !videosOnly;
                    toggleBtn(elBtnVideo, videosOnly);
                    reload();
                });

                elBtnNoPrompt.addEventListener("click", () => {
                    hideNoPrompt = !hideNoPrompt;
                    toggleBtn(elBtnNoPrompt, hideNoPrompt);
                    reload();
                });

                elBtnFavOnly.addEventListener("click", async () => {
                    favoritesOnly = !favoritesOnly;
                    toggleBtn(elBtnFavOnly, favoritesOnly);
                    await reload();
                });

                // Scroll listener (branché/débranché par setRenderState)
                const bindScroll = () => {
                    if (_scrollHandlerBound) return;
                    _scrollHandlerBound = () => { if (nearBottom() && !loading && hasMore && renderEnabled) loadMore(); };
                    elScroll.addEventListener("scroll", _scrollHandlerBound, { passive: true });
                };
                const unbindScroll = () => {
                    if (!_scrollHandlerBound) return;
                    elScroll.removeEventListener("scroll", _scrollHandlerBound);
                    _scrollHandlerBound = null;
                };

                // Display state handler
                const setRenderState = (on) => {
                    renderEnabled = !!on;

                    elBtnRender.classList.toggle("cg-render-on", renderEnabled);
                    elBtnRender.classList.toggle("cg-render-off", !renderEnabled);
                    elBtnRender.textContent = renderEnabled ? "Display: ON" : "Display: OFF";

                    elScroll.classList.toggle("paused", !renderEnabled);
                    root.querySelector(".cg-foot")?.classList.toggle("paused", !renderEnabled);

                    if (!renderEnabled) {
                        // stop observers + scroll
                        try { _ioSentinel?.disconnect(); } catch { }
                        try { _ioVideo?.disconnect(); } catch { }
                        unbindScroll();
                        // pause any playing video
                        elGrid.querySelectorAll("video").forEach(v => { try { v.pause(); } catch { } });
                    } else {
                        // rebuild observers + scroll & auto-reload
                        setupObservers();
                        bindScroll();
                        reload();
                    }
                };

                elBtnRender.addEventListener("click", () => setRenderState(!renderEnabled));

                // Resize => recalc masonry & autofill
                const ro = new ResizeObserver(() => {
                    const w = elScroll.clientWidth || root.clientWidth || 900;
                    const target = Math.max(240, Math.min(360, Math.floor(w / Math.ceil(w / 280))));
                    elGrid.style.setProperty("--colw", `${target}px`);
                    requestAnimationFrame(checkAndAutofill);
                });
                ro.observe(elScroll);

                (async () => {
                    toggleBtn(elBtnVideo, videosOnly);
                    toggleBtn(elBtnNoPrompt, hideNoPrompt);
                    toggleBtn(elBtnFavOnly, favoritesOnly);
                    await loadFavoritesMap();
                    setStatus("");

                    // initial infra
                    setupObservers();
                    bindScroll();
                    setRenderState(true); // ON par défaut
                })();

                return r;
            };
        },
    });
})();


