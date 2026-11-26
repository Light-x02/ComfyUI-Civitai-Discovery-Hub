// ----- SECTION: Imports -----
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { buildGalleryView } from "./gallery-view.js";

// ----- SECTION: Constants -----
const EXT_NAME = "CivitaiDiscoveryHub.InfiniteScroll";
const TARGET_CLASS = "CivitaiDiscoveryHubNode";

const galleries = new WeakMap();
const favoriteChanges = new EventTarget();
const MEDIA_HOSTS = new Set(["image.civitai.com", "image.civitai.red", "image.civitai.green", "image.civitai.work"]);

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

function state(node) {
    node.properties = sanitizeProxyWidgets(node.properties || {});
    return node.properties.__cg ||= {};
}

async function jsonRequest(path, options) {
    const response = await api.fetchApi(path, options);
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || body?.message || [response.status, response.statusText].filter(Boolean).join(" "));
    }
    return response.json();
}

function mediaUrl(value) {
    if (typeof value !== "string") return "";
    try {
        const url = new URL(value);
        return url.protocol === "https:" && MEDIA_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
}

function previewUrl(source, width) {
    if (!source || width === "original") return source;
    const url = new URL(source);
    if (url.search) return source;
    const parts = url.pathname.split("/");
    if (parts.length === 4 && /^[a-f0-9-]{36}$/i.test(parts[2]) && parts[3]) {
        parts.splice(3, 0, "width=" + width);
        url.pathname = parts.join("/");
        return url.href;
    }
    if (parts.length !== 5 || !parts[1] || !parts[2]) return source;
    const options = parts[3].split(",");
    if (!options.some(v => /^(width=\d+|original=true)$/.test(v))) return source;
    parts[3] = [...options.filter(v => !/^(width|height|original)=/.test(v)), "width=" + width].join(",");
    url.pathname = parts.join("/");
    return url.href;
}

function videoUrl(item) {
    const meta = item.meta || {};
    const dedicated = [meta.videoUrl, meta.mp4Url, meta.video, meta.mp4].map(mediaUrl).find(Boolean);
    const url = mediaUrl(item.url);
    if (item.type === "image") return "";
    if (item.type === "video") return url || dedicated || "";
    return dedicated || (/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) ? url : "");
}

function galleryWidget(node) {
    const index = node.inputs?.findIndex(input => input?.name === "selection_data") ?? -1;
    if (index >= 0) node.removeInput(index);
    let widget = node.widgets?.find(w => w.name === "selection_data");
    if (!widget) widget = node.addWidget("text", "selection_data", "{}", () => {}, { multiline: true });
    widget.computeSize = () => [0, 0];
    widget.draw = () => {};
    const element = widget.element || widget.inputEl;
    if (element?.style) element.style.display = "none";
    widget.serializeValue = () => {
        const value = widget.value || "{}";
        try {
            const selection = JSON.parse(value);
            if (!selection?.item) return value;
            selection.download_image = Boolean(node.outputs?.[2]?.links?.length);
            return JSON.stringify(selection);
        } catch {
            return "{}";
        }
    };
    return widget;
}

function galleryOptions(node) {
    const saved = state(node).filters || {};
    return {
        nsfw: saved.nsfw || "None", sort: saved.sort || "Newest", period: saved.period || "AllTime",
        tags: saved.tags || "", username: saved.username || "", limit: String(saved.limit || 24),
        videos_only: saved.videos_only === true, hide_no_prompt: saved.hide_no_prompt === true,
        favorites_only: saved.favorites_only === true,
    };
}

function createGallery(node) {
    const root = buildGalleryView(document);
    const widget = node.addDOMWidget("civitai_gallery", "div", root, { serialize: false });
    widget.serializeValue = () => undefined;
    node.size = [1120, 820];
    const find = name => root.querySelector(`.cg-${name}`);
    const scroll = find("scroll"), grid = find("masonry"), foot = find("foot");
    const status = find("status"), retry = find("retry"), favoriteStatus = find("favorite-status");
    const controls = {
        nsfw: find("nsfw"), sort: find("sort"), period: find("period"),
        tags: find("tags"), username: find("username"), limit: find("limit"),
    };
    const toggles = {
        videos_only: find("toggle-video"), hide_no_prompt: find("toggle-noprompt"), favorites_only: find("toggle-favonly"),
    };
    const thumb = find("thumb"), model = find("model"), modelQuery = find("model-query");
    const modelButton = find("find-model"), modelStatus = find("model-status");
    let modelRequest = null;
    const renderButton = find("toggle-render"), clearPreviews = find("clear-previews");

    let filters, enabled = true, visible = false, removed = false;
    let request = null, idsRequest = null, favoriteIds = null, changedIds = new Map();
    const resolution = find("resolution");
    let starts = [null];
    let current = 0, last = null, retryPage = 1;
    let frame = 0, restoreTop = 0, selectedKey = null;
    const seen = new Set(), pages = new Map(), stars = new Map(), saving = new Set();
    let currentCard = null;

    const panels = ["filters", "models", "view"];

    function showPanel(active) {
        for (const name of panels) {
            const selected = name === active;
            const tab = find("tab-" + name);
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            find("panel-" + name).hidden = !selected;
        }
    }

    for (const [index, name] of panels.entries()) {
        const tab = find("tab-" + name);
        tab.addEventListener("click", () => {
            showPanel(name);
            state(node).panel = name;
            dirty();
        });
        tab.addEventListener("keydown", event => {
            const keys = { ArrowRight: (index + 1) % panels.length, ArrowLeft: (index + panels.length - 1) % panels.length,
                Home: 0, End: panels.length - 1 };
            if (!Object.hasOwn(keys, event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const target = find("tab-" + panels[keys[event.key]]);
            target.focus();
            target.click();
        });
    }

    function dirty() {
        node.graph?.change?.();
        node.setDirtyCanvas(true, true);
    }

    function select(item, card) {
        currentCard?.classList.remove("selected");
        currentCard = card;
        showSelection(item.id);
        card.classList.add("selected");
        const { id, url, type, meta } = item;
        const value = JSON.stringify({ item: { id, url, type, meta }, download_image: Boolean(node.outputs?.[2]?.links?.length) });
        node.widgets.find(w => w.name === "selection_data").value = value;
        dirty();
    }

    function showSelection(id) {
        selectedKey = id == null ? null : String(id);
        find("selection").textContent = selectedKey === null ? "" : `Selected #${selectedKey}`;
    }

    function updateStar(key) {
        const star = stars.get(key);
        if (!star) return;
        const active = filters.favorites_only || Boolean(favoriteIds?.has(key));
        star.textContent = active ? "★" : "☆";
        star.classList.toggle("fav", active);
        star.setAttribute("aria-pressed", String(active));
        star.setAttribute("aria-label", active ? "Remove from favorites" : "Add to favorites");
        star.title = star.getAttribute("aria-label");
        star.disabled = saving.has(key) || (!filters.favorites_only && favoriteIds === null);
    }

    async function loadIds() {
        if (favoriteIds !== null || idsRequest || !enabled || !visible || removed || filters.favorites_only) return;
        const controller = idsRequest = new AbortController();
        changedIds = new Map();
        try {
            const data = await jsonRequest("/civitai_gallery/get_favorite_ids", { signal: controller.signal });
            if (idsRequest !== controller) return;
            if (!Array.isArray(data?.ids)) throw new Error("Invalid favorites index");
            favoriteIds = new Set(data.ids.map(String));
            for (const [id, active] of changedIds) active ? favoriteIds.add(id) : favoriteIds.delete(id);
            favoriteStatus.textContent = "";
            for (const key of stars.keys()) updateStar(key);
        } catch (error) {
            if (idsRequest === controller) favoriteStatus.textContent = `Favorites unavailable: ${error.message}. Use Refresh to retry.`;
        } finally {
            if (idsRequest === controller) idsRequest = null;
        }
    }

    async function toggleFavorite(item) {
        const key = String(item.id);
        if (saving.has(key)) return;
        const favorite = !(filters.favorites_only || favoriteIds?.has(key));
        const body = { item, favorite };
        if (favorite && filters.tags) body.tag_id = filters.tags;
        saving.add(key);
        updateStar(key);
        try {
            const data = await jsonRequest("/civitai_gallery/toggle_favorite", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            });
            if (data.status !== "added" && data.status !== "removed") throw new Error("Unexpected favorite status");
            favoriteChanges.dispatchEvent(new CustomEvent("change", { detail: { key, active: data.status === "added" } }));
            if (!removed) favoriteStatus.textContent = "";
        } catch (error) {
            if (!removed) favoriteStatus.textContent = `Could not save favorite: ${error.message}`;
        } finally {
            saving.delete(key);
            if (!removed) updateStar(key);
        }
    }

    function favoriteChanged({ detail: { key, active } }) {
        if (idsRequest) changedIds.set(key, active);
        if (favoriteIds) active ? favoriteIds.add(key) : favoriteIds.delete(key);
        if (filters.favorites_only) reset(true);
        else updateStar(key);
    }
    favoriteChanges.addEventListener("change", favoriteChanged);

    const videoObserver = new IntersectionObserver(entries => {
        if (!enabled || !visible || removed) return;
        for (const entry of entries) {
            const video = entry.target;
            if (!entry.isIntersecting) {
                video.pause();
            } else if (!video.getAttribute("src") && video.dataset.src) {
                video.preload = "metadata";
                video.src = video.dataset.src;
            }
        }
    }, { root: scroll, rootMargin: "350px" });

    function cardFor(item) {
        const key = String(item.id), meta = item.meta || {};
        const card = document.createElement("div");
        card.className = "cg-card";
        card.dataset.selkey = `image:${key}`;
        card.tabIndex = 0;
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", `Civitai media ${key}. Press Enter to select.`);
        if (key === selectedKey) {
            card.classList.add("selected");
            currentCard = card;
        }
        const source = videoUrl(item);
        const media = document.createElement(source ? "video" : "img");
        media.style.aspectRatio = item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : "4 / 5";
        if (source) {
            media.className = "cg-vid";
            media.controls = true;
            media.muted = true;
            media.playsInline = true;
            media.preload = "none";
            media.dataset.src = source;
            const poster = [item.thumbnail, item.preview, item.cover, item.coverUrl, item.previewUrl, item.image,
                meta.thumbnail, meta.thumbnailUrl, meta.preview, meta.previewUrl, meta.image].map(mediaUrl).find(Boolean);
            if (poster) media.poster = previewUrl(poster, resolution.value);
            // Seek once at metadata load to show a first frame on browsers that render a blank poster.
            else media.addEventListener("loadedmetadata", () => {
                if (media.paused && !media.currentTime && media.duration > 0) media.currentTime = Math.min(0.1, media.duration / 2);
            }, { once: true });
            videoObserver.observe(media);
        } else {
            media.className = "cg-img";
            media.loading = "lazy";
            media.alt = `Civitai image ${key}`;
            const image = mediaUrl(item.url);
            if (image) media.src = previewUrl(image, resolution.value);
        }
        card.appendChild(media);
        const bar = document.createElement("div");
        bar.className = "cg-meta";
        const left = document.createElement("div");
        left.className = "cg-meta-left";
        const date = new Date(item.createdAt);
        const level = item.browsingLevel ?? item.nsfwLevel;
        const rating = ({ 1: "None", 2: "Soft", 4: "Mature", 8: "X", 16: "XXX", 32: "Blocked" })[level]
            || (typeof level === "string" ? level : item.nsfw === true ? "X" : item.nsfw === false ? "None" : "Unrated");
        for (const label of [rating, item.createdAt && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : ""]) {
            if (!label) continue;
            const chip = document.createElement("span");
            chip.className = "cg-chip";
            chip.textContent = label;
            left.appendChild(chip);
        }
        const star = document.createElement("button");
        star.className = "cg-star";
        stars.set(key, star);
        updateStar(key);
        star.addEventListener("click", event => { event.stopPropagation(); void toggleFavorite(item); });
        const open = document.createElement("a");
        open.className = "cg-open";
        open.href = `https://civitai.com/images/${encodeURIComponent(key)}`;
        open.title = "Open on Civitai";
        open.setAttribute("aria-label", "Open media " + key + " on Civitai");
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = "\u2197";
        open.addEventListener("click", event => event.stopPropagation());
        const actions = document.createElement("div");
        actions.className = "cg-meta-left";
        actions.append(star, open);
        bar.append(left, actions);
        card.appendChild(bar);
        card.addEventListener("click", () => select(item, card));
        card.addEventListener("keydown", event => {
            if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            select(item, card);
        });
        return card;
    }

    function unmount(page) {
        if (!page.mounted) return;
        // Keep the page footprint when releasing its media so scrolling cannot jump.
        const height = page.element.offsetHeight || estimateHeight(page.items);
        page.element.style.height = `${height}px`;
        for (const image of page.element.querySelectorAll("img")) image.removeAttribute("src");
        for (const video of page.element.querySelectorAll("video")) {
            videoObserver.unobserve(video);
            video.pause();
            delete video.dataset.src;
            video.removeAttribute("poster");
            if (video.getAttribute("src")) {
                video.removeAttribute("src");
                video.load();
            }
        }
        if (currentCard && page.element.contains(currentCard)) currentCard = null;
        for (const item of page.items) stars.delete(String(item.id));
        page.element.replaceChildren();
        page.mounted = false;
    }

    function mount(page) {
        if (page.mounted) return;
        page.mounted = true;
        page.element.style.height = "";
        page.element.append(...page.items.map(cardFor));
    }

    const pageObserver = new IntersectionObserver(entries => {
        if (!enabled || !visible || removed) return;
        for (const entry of entries) {
            const page = pages.get(entry.target);
            if (!page) continue;
            if (entry.isIntersecting) mount(page);
            else if (!page.element.contains(document.activeElement)) unmount(page);
        }
    }, { root: scroll, rootMargin: "350px" });

    function estimateHeight(items) {
        const width = grid.clientWidth || Math.max(260, (node.size?.[0] || 900) - 32);
        const count = Math.max(1, Math.floor((width + 12) / (Number(thumb.value) + 12)));
        const column = (width - (count - 1) * 12) / count;
        const total = items.reduce((sum, item) => sum + column * (item.width > 0 && item.height > 0 ? item.height / item.width : 1.25) + 55, 0);
        return Math.ceil(total / Math.min(items.length, count));
    }

    function append(items) {
        const fresh = [];
        for (const item of items) {
            if (item?.id == null || seen.has(String(item.id))) continue;
            fresh.push(item);
            seen.add(String(item.id));
        }
        // Keep at least one full row even with small thumbnails on a wide node.
        const columns = Math.max(1, Math.floor((grid.clientWidth + 12) / (Number(thumb.value) + 12)));
        const groupSize = Math.ceil(6 / columns) * columns;
        for (let start = 0; start < fresh.length; start += groupSize) {
            const chunk = fresh.slice(start, start + groupSize);
            const element = document.createElement("div");
            element.className = "cg-page";
            element.style.height = `${estimateHeight(chunk)}px`;
            const page = { element, items: chunk, mounted: false };
            const first = pages.size === 0;
            pages.set(element, page);
            grid.appendChild(element);
            if (first) mount(page);
            pageObserver.observe(element);
        }
        return fresh.length;
    }

    function schedule() {
        if (frame || !enabled || !visible || removed) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!enabled || !visible || removed || request) return;
            if (restoreTop > 0) {
                scroll.scrollTop = restoreTop;
                if (scroll.scrollTop >= restoreTop - 1 || current > 0) restoreTop = 0;
            }
        });
    }

    function streamParams(token) {
        const params = new URLSearchParams({
            nsfw: filters.nsfw, sort: filters.sort, period: filters.period,
            videos_only: filters.videos_only, hide_no_prompt: filters.hide_no_prompt,
        });
        if (filters.username) params.set("username", filters.username);
        if (filters.tags) params.set("tags", filters.tags);
        if (filters.favorites_only) {
            params.set("offset", String(token ?? 0));
            params.set("limit", filters.limit);
            return `/civitai_gallery/get_favorites_images?${params}`;
        }
        if (state(node).model?.id) params.set("modelId", state(node).model.id);
        params.set("min_batch", filters.limit);
        params.set("include_videos", filters.videos_only);
        if (token != null) params.set("cursor", token);
        return `/civitai_gallery/images_stream?${params}`;
    }

    function renderPager() {
        const available = last ?? starts.length;
        const active = current || retryPage;
        const busy = Boolean(request);
        find("first").disabled = find("prev").disabled = busy || active === 1;
        find("next").disabled = busy || active >= available;
        const numbers = find("numbers");
        numbers.replaceChildren();
        const start = Math.max(1, Math.min(active - 2, available - 4));
        for (let n = start; n <= Math.min(available, start + 4); n++) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "cg-btn";
            button.textContent = String(n);
            button.setAttribute("aria-label", "Page " + n);
            if (n === active) button.setAttribute("aria-current", "page");
            button.disabled = busy || n === active;
            button.addEventListener("click", () => loadPage(n));
            numbers.appendChild(button);
        }
    }

    async function loadPage(number) {
        if (removed || !enabled || !visible || request || number < 1 || number > (last ?? starts.length)) return;
        const controller = request = new AbortController();
        retryPage = number;
        retry.hidden = true;
        renderPager();
        status.textContent = "Loading page " + number + "...";
        let token = filters.favorites_only ? (number - 1) * Number(filters.limit) : starts[number - 1];
        try {
            let data, following, repeated;
            const used = new Set(starts.slice(0, number - 1).map(String));
            // A filtered upstream batch can be empty even though a later batch matches.
            for (let attempt = 0; attempt < 3; attempt++) {
                used.add(String(token));
                data = await jsonRequest(streamParams(token), { signal: controller.signal });
                if (controller !== request) return;
                if (!Array.isArray(data?.items) || !data.metadata) throw new Error("Invalid gallery response");
                following = filters.favorites_only ? data.metadata.nextOffset : data.metadata.nextCursor;
                repeated = following != null && used.has(String(following));
                if (data.items.length || following == null || repeated) break;
                token = following;
            }
            if (filters.favorites_only) {
                last = Math.max(1, Number(data.metadata.totalPages) || Math.ceil(data.metadata.totalItems / Number(filters.limit)) || 1);
            } else {
                if (following == null || repeated) {
                    starts.length = number;
                    last = number;
                } else if (starts[number] !== following) {
                    starts.length = number;
                    starts.push(following);
                    last = null;
                }
            }
            if (current) {
                restoreTop = 0;
                scroll.scrollTop = 0;
                state(node).scroll_top = 0;
            }
            clearCards();
            const pageChanged = current > 0 && current !== number;
            current = number;
            state(node).pagination = { page: number, starts: [...starts], last };
            if (pageChanged) dirty();
            const count = append(data.items);
            const pageLabel = "Page " + number + (last ? " / " + last : "") + " (" + count + ")";
            status.textContent = repeated ? "The server returned a repeated page." : pageLabel;
            if (!repeated && !count && filters.hide_no_prompt) {
                status.textContent = following == null ? "No images or videos with a public prompt match these filters." :
                    "No public prompt in this batch. Use the next page to keep searching.";
            }
        } catch (error) {
            if (request !== controller) return;
            retry.textContent = "Retry";
            retry.hidden = false;
            status.textContent = "Error: " + error.message;
        } finally {
            if (controller === request) {
                request = null;
                renderPager();
                schedule();
            }
        }
    }
    find("first").addEventListener("click", () => loadPage(1));
    find("prev").addEventListener("click", () => loadPage(current - 1));
    find("next").addEventListener("click", () => loadPage(current + 1));

    function cancel() {
        request?.abort();
        request = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    }

    function clearCards() {
        for (const page of pages.values()) {
            pageObserver.unobserve(page.element);
            unmount(page);
        }
        pages.clear();
        seen.clear();
        currentCard = null;
        grid.replaceChildren();
    }

    function reset(top) {
        cancel();
        clearCards();
        const cg = state(node);
        if (top) delete cg.pagination;
        const saved = cg.pagination;
        starts = Array.isArray(saved?.starts) && saved.starts[0] === null &&
            saved.starts.slice(1).every(token => typeof token === "string" || Number.isFinite(token))
            ? [...saved.starts] : [null];
        last = Number.isSafeInteger(saved?.last) && saved.last > 0 ? saved.last : null;
        const available = filters.favorites_only ? (last || 1) : starts.length;
        retryPage = Number.isSafeInteger(saved?.page) && saved.page > 0 && saved.page <= available ? saved.page : 1;
        current = 0;
        renderPager();
        if (top) {
            restoreTop = 0;
            state(node).scroll_top = 0;
        }
        scroll.scrollTop = 0;
        retry.hidden = true;
        status.textContent = "";
        if (enabled && visible && !removed) {
            void loadIds();
            void loadPage(retryPage);
        }
    }

    function pause() {
        cancel();
        restoreTop = restoreTop || state(node).scroll_top || 0;
        idsRequest?.abort();
        idsRequest = null;
        for (const page of pages.values()) unmount(page);
        pageObserver.disconnect();
        videoObserver.disconnect();
    }

    function resume() {
        if (!visible || !enabled || removed) return;
        for (const page of pages.values()) pageObserver.observe(page.element);
        void loadIds();
        if (!current) void loadPage(retryPage);
        renderPager();
        schedule();
    }

    const viewport = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.target !== root || visible === entry.isIntersecting || removed) continue;
            visible = entry.isIntersecting;
            if (visible) resume();
            else pause();
        }
    });
    viewport.observe(root);

    function display(on) {
        enabled = on;
        if (!on) pause();
        clearPreviews.disabled = !on && pages.size === 0;
        renderButton.classList.toggle("cg-render-on", on);
        renderButton.classList.toggle("cg-render-off", !on);
        renderButton.setAttribute("aria-pressed", String(on));
        renderButton.textContent = on ? "Display: ON" : "Display: OFF";
        scroll.classList.toggle("paused", !on);
        foot.classList.toggle("paused", !on);
        if (on) resume();
    }

    function renderToggles() {
        model.disabled = modelQuery.disabled = modelButton.disabled = filters.favorites_only;
        find("model-hint").hidden = !filters.favorites_only;
        if (filters.favorites_only) cancelModelSearch();
        for (const [key, button] of Object.entries(toggles)) {
            button.classList.toggle("active", filters[key]);
            button.setAttribute("aria-pressed", String(filters[key]));
        }
    }

    function setThumbnailWidth(value) {
        thumb.value = ["160", "220", "280", "400"].includes(value) ? value : "280";
        grid.style.setProperty("--cg-thumb-width", thumb.value + "px");
        for (const page of pages.values()) {
            if (!page.mounted) page.element.style.height = estimateHeight(page.items) + "px";
        }
        schedule();
    }

    thumb.addEventListener("change", () => {
        setThumbnailWidth(thumb.value);
        state(node).thumbnail_width = thumb.value;
        dirty();
    });

    function modelOptions(items = []) {
        const selected = state(node).model;
        model.replaceChildren();
        function option(value, label) {
            const element = document.createElement("option");
            element.value = value;
            element.textContent = label;
            model.appendChild(element);
        }
        option("", "All models");
        if (selected?.id) option(selected.id, selected.label);
        for (const item of items) {
            if (String(item.id) !== selected?.id) option(String(item.id), item.name + " (" + item.type + " #" + item.id + ")");
        }
        model.value = selected?.id || "";
        find("tab-models").classList.toggle("cg-has-model", Boolean(selected?.id));
        find("tab-models").title = selected?.label || "Search by checkpoint or LoRA name";
    }

    function cancelModelSearch() {
        modelRequest?.abort();
        modelRequest = null;
        modelStatus.textContent = "";
    }

    async function searchModels() {
        cancelModelSearch();
        const query = modelQuery.value.trim();
        modelOptions();
        if (!query || filters.favorites_only) return;
        const controller = modelRequest = new AbortController();
        modelStatus.textContent = "Searching...";
        try {
            const data = await jsonRequest("/civitai_gallery/models?" + new URLSearchParams({ query }), { signal: controller.signal });
            if (controller !== modelRequest) return;
            modelOptions(data.items);
            modelStatus.textContent = data.items.length ? "Choose a model." : "No models found.";
        } catch (error) {
            if (controller === modelRequest) modelStatus.textContent = error.message;
        } finally {
            if (controller === modelRequest) modelRequest = null;
        }
    }

    find("clear-model").addEventListener("click", () => {
        cancelModelSearch();
        modelQuery.value = "";
        const selected = state(node).model;
        state(node).model = null;
        modelOptions();
        if (selected) applyFilters();
    });
    resolution.addEventListener("change", () => {
        state(node).preview_resolution = resolution.value;
        for (const page of pages.values()) {
            if (page.mounted) { unmount(page); mount(page); }
        }
        dirty();
    });

    modelButton.addEventListener("click", searchModels);
    modelQuery.addEventListener("input", () => { cancelModelSearch(); modelOptions(); });
    modelQuery.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); searchModels(); }
    });
    model.addEventListener("change", () => {
        state(node).model = model.value ? { id: model.value, label: model.selectedOptions[0].textContent } : null;
        modelStatus.textContent = "";
        applyFilters();
    });

    function configure(savedSelection) {
        const cg = state(node);
        showPanel(panels.includes(cg.panel) ? cg.panel : "filters");
        cancelModelSearch();
        modelQuery.value = "";
        modelOptions();
        resolution.value = ["256", "768", "1024", "original"].includes(cg.preview_resolution) ? cg.preview_resolution : "512";
        setThumbnailWidth(cg.thumbnail_width);
        const selection = galleryWidget(node);
        if (typeof savedSelection === "string") selection.value = savedSelection;
        else if (typeof cg.selection_data === "string") selection.value = cg.selection_data;
        delete cg.selection_data;
        try {
            showSelection(JSON.parse(selection.value || "{}")?.item?.id);
        } catch { showSelection(null); }
        filters = galleryOptions(node);
        for (const [key, input] of Object.entries(controls)) {
            input.value = filters[key];
            if (!input.value && key !== "username" && key !== "tags" && input.options?.length) {
                input.selectedIndex = 0;
                filters[key] = input.value;
            }
        }
        renderToggles();
        restoreTop = Number.isFinite(cg.scroll_top) ? cg.scroll_top : 0;
        enabled = cg.display_on !== false;
        reset(false);
        display(enabled);
    }

    function applyFilters() {
        for (const [key, input] of Object.entries(controls)) filters[key] = input.value.trim();
        state(node).filters = { ...filters };
        renderToggles();
        reset(true);
        dirty();
    }
    for (const [key, input] of Object.entries(controls)) {
        if (key !== "username") input.addEventListener("change", applyFilters);
    }
    controls.username.addEventListener("keydown", e => { if (e.key === "Enter") applyFilters(); });
    find("search").addEventListener("click", applyFilters);
    for (const [key, button] of Object.entries(toggles)) {
        button.addEventListener("click", () => {
            filters[key] = !filters[key];
            applyFilters();
        });
    }
    find("refresh").addEventListener("click", () => {
        favoriteIds = null;
        idsRequest?.abort();
        idsRequest = null;
        applyFilters();
    });
    retry.addEventListener("click", () => {
        void loadPage(retryPage);
    });
    clearPreviews.addEventListener("click", () => {
        state(node).display_on = false;
        display(false);
        clearCards();
        retryPage = current || retryPage;
        current = 0;
        favoriteIds = null;
        changedIds.clear();
        favoriteStatus.textContent = "";
        clearPreviews.disabled = true;
        dirty();
    });
    renderButton.addEventListener("click", () => {
        state(node).display_on = !enabled;
        display(!enabled);
        dirty();
    });

    scroll.addEventListener("scroll", () => {
        if (!enabled || !visible || removed) return;
        if (!restoreTop) state(node).scroll_top = scroll.scrollTop;
        schedule();
    }, { passive: true });
    const stopRestoring = () => { restoreTop = 0; };
    scroll.addEventListener("wheel", stopRestoring, { passive: true });
    scroll.addEventListener("pointerdown", stopRestoring, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    const previousResize = node.onResize;
    node.onResize = function (size) {
        size[0] = Math.max(720, size[0]);
        size[1] = Math.max(420, size[1]);
        return previousResize?.call(this, size) ?? size;
    };

    function dispose() {
        removed = true;
        cancelModelSearch();
        pause();
        viewport.disconnect();
        resize.disconnect();
        favoriteChanges.removeEventListener("change", favoriteChanged);
        pages.clear();
        seen.clear();
        stars.clear();
        grid.replaceChildren();
    }
    configure();
    return { configure, dispose };
}

app.registerExtension({
    name: EXT_NAME,
    beforeRegisterNodeDef(nodeType, nodeData) {
        if ((nodeType.comfyClass || nodeData.name) !== TARGET_CLASS) return;
        const proto = nodeType.prototype;
        const create = proto.onNodeCreated, configure = proto.configure, remove = proto.onRemoved;
        proto.onNodeCreated = function (...args) {
            const result = create?.apply(this, args);
            const cg = state(this);
            if (!cg.colored_once) {
                this.color = "#000000";
                this.bgcolor = "#0b0b0b";
                this.boxcolor = "#1e1e1e";
                this.title_color = "#ffffff";
                cg.colored_once = true;
            }
            galleryWidget(this);
            galleries.set(this, createGallery(this));
            return result;
        };
        proto.configure = function (data, ...args) {
            if (data?.properties) {
                data = { ...data, properties: sanitizeProxyWidgets({ ...data.properties }) };
                if (data.properties.__cg) data.properties.__cg = { ...data.properties.__cg };
            }
            const selection = data?.properties?.__cg?.selection_data;
            const result = configure?.call(this, data, ...args);
            galleries.get(this)?.configure(selection);
            const size = data?.size;
            if (size && Number.isFinite(size[0]) && Number.isFinite(size[1]) &&
                size[0] >= 720 && size[1] >= 420 && (this.size[0] !== size[0] || this.size[1] !== size[1])) {
                this.size = [size[0], size[1]];
            }
            return result;
        };
        proto.onRemoved = function (...args) {
            galleries.get(this)?.dispose();
            galleries.delete(this);
            return remove?.apply(this, args);
        };
    },
});
