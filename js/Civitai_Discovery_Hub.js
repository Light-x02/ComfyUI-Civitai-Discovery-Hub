// ----- SECTION: Imports -----
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { buildGalleryView } from "./gallery-view.js";
import { galleryLabels, hubLanguage, loadHubLanguage } from "./hub-i18n.js";
import { creatorSuggestions, modelFilters } from "./gallery-catalog.js";
import { readMediaLink, resourcePanel } from "./gallery-selection.js";
import { storagePanel } from "./gallery-storage.js";
import { detailPanel } from "./gallery-details.js";
import { galleryLibrary } from "./gallery-library.js";
import { collectionExplorer } from "./gallery-collections.js";
import { previewImages } from "./gallery-preview-cache.js";

// ----- SECTION: Constants -----
const EXT_NAME = "CivitaiDiscoveryHub.InfiniteScroll";
const TARGET_CLASS = "CivitaiDiscoveryHubNode";

const galleries = new WeakMap();
const favoriteChanges = new EventTarget();
const MEDIA_HOSTS = new Set([
    "image.civitai.com", "image-b2.civitai.com", "blobs-b2.civitai.com",
    "image.civitai.red", "image.civitai.green", "image.civitai.work",
]);

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

function posterUrl(item) {
    const meta = item.meta || {};
    return [item.thumbnail?.url, item.thumbnail, item.preview, item.cover, item.coverUrl, item.previewUrl, item.image,
        meta.thumbnail, meta.thumbnailUrl, meta.preview, meta.previewUrl, meta.image].map(mediaUrl).find(Boolean) || "";
}

function galleryWidget(node) {
    const index = node.inputs?.findIndex(input => input?.name === "selection_data") ?? -1;
    if (index >= 0) node.removeInput(index);
    let widget = node.widgets?.find(w => w.name === "selection_data");
    if (!widget) widget = node.addWidget("text", "selection_data", "{}", () => {}, { multiline: true });
    widget.hidden = true;
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
        tags: String(saved.tags || ""), baseModels: saved.baseModels || "", username: saved.username || "", limit: String(saved.limit || 24),
        videos_only: saved.videos_only === true, hide_no_prompt: saved.hide_no_prompt === true,
        favorites_only: saved.favorites_only === true, collection: typeof saved.collection === "string" ? saved.collection : "",
    };
}

function createGallery(node) {
    const language = hubLanguage(app, document);
    const t = galleryLabels(language);
    const dateFormat = new Intl.DateTimeFormat(language);
    const root = buildGalleryView(document, t);
    root.lang = language;
    const widget = node.addDOMWidget("civitai_gallery", "div", root, { serialize: false });
    widget.serializeValue = () => undefined;
    node.size = [1120, 820];
    const find = name => root.querySelector(`.cg-${name}`);
    const scroll = find("scroll"), grid = find("masonry"), foot = find("foot");
    const collectionEntry = find("collections-entry");
    const status = find("status"), retry = find("retry"), favoriteStatus = find("favorite-status");
    const controls = {
        nsfw: find("nsfw"), sort: find("sort"), period: find("period"),
        baseModels: find("base"), username: find("username"), limit: find("limit"),
    };
    const toggles = {
        videos_only: find("toggle-video"), hide_no_prompt: find("toggle-noprompt"), favorites_only: find("toggle-favonly"),
    };
    const thumb = find("thumb"), tags = find("tags"), linkInput = find("link-input");
    const tagOptions = new Map(Array.from(tags.options, option => [option.value, option]));
    const appliedFilters = find("applied");
    async function jsonRequest(path, options) {
        let response;
        try {
            response = await api.fetchApi(path, options);
        } catch (error) {
            if (error.name === "AbortError") throw error;
            throw new Error(t("Could not connect to ComfyUI."), { cause: error });
        }
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            const message = body?.error || body?.message;
            const match = /^Civitai returned HTTP (\d{3})\.$/.exec(message);
            if (match) throw new Error(t("Civitai returned HTTP {code}.", { code: match[1] }));
            throw new Error(message ? t(message) : t("Request failed (HTTP {code}).", { code: response.status }));
        }
        try { return await response.json(); }
        catch (error) {
            if (error.name === "AbortError") throw error;
            throw new Error(t("Invalid JSON response."), { cause: error });
        }
    }

    const models = modelFilters(document, find, jsonRequest, () => state(node), applyFilters, dirty, t);
    const resources = resourcePanel(document, find, jsonRequest, t);
    const storage = storagePanel(document, find, jsonRequest, favoriteChanges, t);
    const cancelSuggestions = creatorSuggestions(document, find, jsonRequest, () => enabled && visible && !inFavorites());
    const renderButton = find("toggle-render");

    let filters, enabled = true, visible = false, removed = false;
    let request = null, idsRequest = null, favoriteIds = null, changedIds = new Map();
    const resolution = find("resolution");
    let starts = [null];
    let current = 0, last = null, retryPage = 1;
    let frame = 0, restoreTop = 0, selectedKey = null, retryShuffle = false;
    const slots = new Map(), stars = new Map(), saving = new Set();
    let currentCard = null;

    const panels = ["filters", "models", "link", "view", "storage"];
    const linkSource = () => state(node).link;
    const navigation = () => linkSource() || state(node);
    const inFavorites = () => filters.favorites_only && !linkSource();
    const inShuffle = () => filters.sort === "Random" && !linkSource();

    let cacheNewPreviews = true;
    const previews = previewImages(document.defaultView, (url, options) => api.fetchApi(url, options), api.user, () => cacheNewPreviews);
    const clearCache = find("clear-cache"), cacheStatus = find("cache-status");
    clearCache.textContent = t("Clear image cache");
    clearCache.title = t("Saved previews for this ComfyUI profile in this browser (up to 64 MiB).");
    clearCache.addEventListener("click", async () => {
        clearCache.disabled = true;
        cacheNewPreviews = false;
        try {
            const count = await previews.clear();
            if (count === null) cacheStatus.textContent = t("Persistent preview storage is unavailable here.");
            else if (!count) cacheStatus.textContent = t("No stored previews.");
            else cacheStatus.textContent = t(count === 1 ? "1 preview removed." : "{count} previews removed.", { count });
        } catch {
            cacheStatus.textContent = t("Could not clear the image cache.");
        } finally { clearCache.disabled = false; }
    });
    const collections = collectionExplorer(document, find, jsonRequest, favoriteChanges, {
        rating: () => filters.nsfw,
        folder: () => inFavorites() ? filters.collection : "",
        preview: url => previewUrl(mediaUrl(url), resolution.value),
        cover: previews.show, release: previews.release,
        browse(name) { if (filters.collection !== name) { filters.collection = name; commitFilters(); } },
        onOpen() { library.close(); details.close(); resources.close(); appliedFilters.open = false; },
    }, t);
    const library = galleryLibrary(document, find, jsonRequest, favoriteChanges, {
        snapshot() {
            const { limit, ...criteria } = filters;
            const cg = state(node);
            return { filters: criteria, model: cg.model || null, model_search_type: cg.model_search_type || "" };
        },
        apply(settings) {
            const cg = state(node);
            cg.filters = { ...settings.filters, limit: filters.limit };
            cg.model = settings.model || null;
            cg.model_search_type = settings.model_search_type || "";
            filters = galleryOptions(node);
            restoreFilterControls();
            commitFilters();
        },
        onOpen() { collections.close(); details.close(); resources.close(); appliedFilters.open = false; },
    }, t);
    const details = detailPanel(document, find, () => {
        collections.close();
        library.close();
        resources.close();
        for (const player of grid.querySelectorAll("video")) player.pause();
        const slot = [...slots.values()].find(row => String(row.item.id) === selectedKey);
        const item = slot?.item || JSON.parse(node.widgets.find(w => w.name === "selection_data").value).item;
        showDetails(item, slot);
    }, stepDetails, previews, t);
    find("resource-toggle").addEventListener("click", () => { details.close(); library.close(); collections.close(); });

    function showPanel(active) {
        if (active !== "storage") cacheNewPreviews = true;
        collections.close();
        library.close();
        details.close();
        find("saved-toggle").hidden = active !== "filters" || Boolean(linkSource());
        if (active === "storage") void storage.load();
        if (active !== "filters") cancelSuggestions();
        if (active !== "models") models.cancel();
        appliedFilters.open = false;
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
            if (name === "models" && enabled && visible) models.loadIfNeeded();
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
        showSelection(item);
        card?.classList.add("selected");
        const { id, url, type, meta, modelVersionIds } = item;
        const value = JSON.stringify({ item: { id, url, type, meta, modelVersionIds }, download_image: Boolean(node.outputs?.[2]?.links?.length) });
        node.widgets.find(w => w.name === "selection_data").value = value;
        dirty();
    }

    function showSelection(item) {
        selectedKey = item?.id == null ? null : String(item.id);
        find("selection").textContent = selectedKey === null ? "" : t("Selected #{id}", { id: selectedKey });
        resources.select(item);
        find("detail-toggle").hidden = selectedKey === null;
        if (details.open && item) showDetails(item, [...slots.values()].find(slot => String(slot.item.id) === selectedKey));
    }

    function showDetails(item, slot) {
        const video = videoUrl(item);
        const original = video || item.type === "video" ? "" : mediaUrl(item.url);
        const mounted = slot?.card?.querySelector("img");
        const preview = previews.source(mounted) || previewUrl(original || posterUrl(item), resolution.value);
        details.show(item, { original, preview, video });
        updateDetailNavigation();
    }
    function updateDetailNavigation() {
        if (!details.open) return;
        const index = [...slots.values()].findIndex(slot => String(slot.item.id) === selectedKey);
        const hasPage = !inShuffle() && current > 0;
        find("detail-prev").disabled = Boolean(request) || index < 0 || (index === 0 && !(hasPage && current > 1));
        find("detail-next").disabled = Boolean(request) || index < 0 ||
            (index === slots.size - 1 && !(hasPage && current < (last ?? starts.length)));
        find("detail-position").textContent = index < 0 ? t("Saved selection") : (index + 1) + " / " + slots.size;
    }
    function selectDetail([element, slot]) {
        const top = parseFloat(element.style.top), height = parseFloat(element.style.height);
        if (top < scroll.scrollTop || top + height > scroll.scrollTop + scroll.clientHeight) {
            restoreTop = 0;
            scroll.scrollTop = Math.max(0, top - Math.max(0, (scroll.clientHeight - height) / 2));
        }
        select(slot.item, slot.card);
    }
    function stepDetails(delta) {
        if (find(delta < 0 ? "detail-prev" : "detail-next").disabled) return;
        const entries = [...slots];
        const index = entries.findIndex(([, slot]) => String(slot.item.id) === selectedKey);
        if (entries[index + delta]) selectDetail(entries[index + delta]);
        else void loadPage(current + delta, false, delta);
    }

    function updateStar(key) {
        const star = stars.get(key);
        if (!star) return;
        const active = inFavorites() || Boolean(favoriteIds?.has(key));
        star.textContent = active ? "★" : "☆";
        star.classList.toggle("fav", active);
        star.setAttribute("aria-pressed", String(active));
        star.setAttribute("aria-label", t(active ? "Remove from favorites" : "Add to favorites"));
        star.title = star.getAttribute("aria-label");
        star.disabled = saving.has(key) || (!inFavorites() && favoriteIds === null);
    }

    async function loadIds() {
        if (favoriteIds !== null || idsRequest || !enabled || !visible || removed || inFavorites()) return;
        const controller = idsRequest = new AbortController();
        changedIds = new Map();
        try {
            const data = await jsonRequest("/civitai_gallery/get_favorite_ids", { signal: controller.signal });
            if (idsRequest !== controller) return;
            if (!Array.isArray(data?.ids)) throw new Error(t("Invalid favorites index"));
            favoriteIds = new Set(data.ids.map(String));
            for (const [id, active] of changedIds) active ? favoriteIds.add(id) : favoriteIds.delete(id);
            favoriteStatus.textContent = "";
            for (const key of stars.keys()) updateStar(key);
        } catch (error) {
            if (idsRequest === controller) favoriteStatus.textContent = t("Favorites unavailable: {reason}. Use Refresh to retry.", { reason: error.message.replace(/[.。]$/, "") });
        } finally {
            if (idsRequest === controller) idsRequest = null;
        }
    }

    async function toggleFavorite(item) {
        const key = String(item.id);
        if (saving.has(key)) return;
        const favorite = !(inFavorites() || favoriteIds?.has(key));
        const body = { item, favorite };
        if (favorite && !linkSource() && filters.tags && !filters.tags.includes(",")) body.tag_id = filters.tags;
        saving.add(key);
        updateStar(key);
        try {
            const data = await jsonRequest("/civitai_gallery/toggle_favorite", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            });
            if (data.status !== "added" && data.status !== "removed") throw new Error(t("Unexpected favorite status"));
            favoriteChanges.dispatchEvent(new CustomEvent("change", { detail: { key, active: data.status === "added" } }));
            if (!removed) favoriteStatus.textContent = "";
        } catch (error) {
            if (!removed) favoriteStatus.textContent = t("Could not save favorite: {reason}", { reason: error.message });
        } finally {
            saving.delete(key);
            if (!removed) updateStar(key);
        }
    }

    function favoriteChanged({ detail: { key, active } }) {
        if (idsRequest) changedIds.set(key, active);
        if (favoriteIds) active ? favoriteIds.add(key) : favoriteIds.delete(key);
        if (inFavorites()) reset(true);
        else updateStar(key);
    }
    function collectionChanged({ detail }) {
        if (detail.action === "cover") return;
        if (filters.collection !== detail.name) return;
        if (detail.action === "delete") {
            filters.collection = "";
            state(node).filters = { ...filters };
            dirty();
        }
        if (inFavorites()) { renderToggles(); reset(true); }
    }
    favoriteChanges.addEventListener("change", favoriteChanged);
    favoriteChanges.addEventListener("collections", collectionChanged);

    function cardFor(item, source) {
        const key = String(item.id);
        const card = document.createElement("div");
        card.className = "cg-card";
        card.dataset.selkey = `image:${key}`;
        card.tabIndex = 0;
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", t("Civitai media {id}. Press Enter to select.", { id: key }));
        if (key === selectedKey) {
            card.classList.add("selected");
            currentCard = card;
        }
        function videoPlayer() {
            const media = document.createElement("video");
            media.className = "cg-vid";
            media.controls = true;
            media.muted = true;
            media.playsInline = true;
            media.src = source;
            return media;
        }
        if (source) {
            const poster = posterUrl(item);
            if (poster) {
                const play = document.createElement("button");
                play.type = "button";
                play.className = "cg-play-preview";
                play.setAttribute("aria-label", t("Play video {id}", { id: key }));
                const image = document.createElement("img");
                image.loading = "lazy";
                image.alt = "";
                const posterSource = previewUrl(poster, resolution.value);
                previews.show(image, posterSource);
                play.appendChild(image);
                play.addEventListener("click", () => {
                    const player = videoPlayer();
                    previews.show(player, posterSource, "poster");
                    previews.release(image);
                    play.replaceWith(player);
                    player.focus({ preventScroll: true });
                    void player.play().catch(() => {}); // Native playback controls remain available.
                }, { once: true });
                card.appendChild(play);
            } else {
                const media = videoPlayer();
                media.preload = "metadata";
                media.addEventListener("loadedmetadata", () => {
                    if (media.paused && !media.currentTime && media.duration > 0) media.currentTime = Math.min(0.1, media.duration / 2);
                }, { once: true });
                card.appendChild(media);
            }
        } else {
            const media = document.createElement("img");
            media.className = "cg-img";
            media.loading = "lazy";
            media.alt = t("Civitai image {id}", { id: key });
            const image = mediaUrl(item.url);
            if (image) previews.show(media, previewUrl(image, resolution.value));
            card.appendChild(media);
        }
        const bar = document.createElement("div");
        bar.className = "cg-meta";
        const left = document.createElement("div");
        left.className = "cg-meta-left";
        const date = new Date(item.createdAt);
        const level = item.browsingLevel ?? item.nsfwLevel;
        const rating = ({ 1: "None", 2: "Soft", 4: "Mature", 8: "X", 16: "XXX", 32: "Blocked" })[level]
            || (typeof level === "string" ? level : item.nsfw === true ? "X" : item.nsfw === false ? "None" : "Unrated");
        if (rating && rating !== "None") {
            const chip = document.createElement("span");
            chip.className = "cg-chip cg-content-rating";
            chip.textContent = t(rating);
            chip.title = t("NSFW level: {rating}", { rating: chip.textContent });
            chip.setAttribute("aria-label", chip.title);
            left.appendChild(chip);
        }
        if (item.createdAt && Number.isFinite(date.getTime())) {
            const stamp = document.createElement("span");
            stamp.className = "cg-chip";
            stamp.textContent = dateFormat.format(date);
            left.appendChild(stamp);
        }
        const star = document.createElement("button");
        star.className = "cg-star";
        stars.set(key, star);
        updateStar(key);
        star.addEventListener("click", event => { event.stopPropagation(); void toggleFavorite(item); });
        const open = document.createElement("a");
        open.className = "cg-open";
        open.href = `https://civitai.com/images/${encodeURIComponent(key)}`;
        open.title = t("Open on Civitai");
        open.setAttribute("aria-label", t("Open media {id} on Civitai", { id: key }));
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = "\u2197";
        open.addEventListener("click", event => event.stopPropagation());
        const actions = document.createElement("div");
        actions.className = "cg-meta-left";
        actions.append(star, open);
        bar.append(left, actions);
        card.append(bar, collections.addButton(item, !source && item.type !== "video" && Boolean(mediaUrl(item.url)),
            !linkSource() && !filters.tags.includes(",") ? filters.tags : ""));
        card.addEventListener("click", () => select(item, card));
        card.addEventListener("keydown", event => {
            if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            select(item, card);
        });
        return card;
    }

    function unmount(element, slot) {
        if (!slot.card) return;
        collections.unmount(slot.card);
        const video = slot.card.querySelector("video");
        if (video) {
            video.pause();
            previews.release(video);
            video.removeAttribute("src");
            video.load();
        } else previews.release(slot.card.querySelector("img"));
        if (currentCard === slot.card) currentCard = null;
        stars.delete(String(slot.item.id));
        element.replaceChildren();
        slot.card = null;
    }

    function mount(element, slot) {
        if (slot.card) return;
        slot.card = cardFor(slot.item, slot.source);
        element.appendChild(slot.card);
    }

    const cardObserver = new IntersectionObserver(entries => {
        if (!enabled || !visible || removed) return;
        for (const { target, isIntersecting } of entries) {
            const slot = slots.get(target);
            if (!slot) continue;
            if (isIntersecting) mount(target, slot);
            else if (target.contains(document.activeElement)) slot.card?.querySelector("video")?.pause();
            else unmount(target, slot);
        }
    }, { root: scroll, rootMargin: "350px" });

    function layoutCards() {
        const width = grid.clientWidth;
        if (!width || (!slots.size && collectionEntry.hidden)) return;
        const gap = 12;
        const count = Math.max(1, Math.floor((width + gap) / (Number(thumb.value) + gap)));
        const columnWidth = (width - (count - 1) * gap) / count;
        const videoLimit = (document.documentElement?.clientHeight || scroll.clientHeight) * 0.72;
        const bottoms = Array(count).fill(0);
        grid.style.setProperty("--cg-column-width", columnWidth + "px");
        if (!collectionEntry.hidden) bottoms[0] = columnWidth * 1.5 + gap;
        for (const [element, { item, source }] of slots) {
            const column = bottoms.indexOf(Math.min(...bottoms));
            const ratio = item.width > 0 && item.height > 0 ? item.height / item.width : 1.25;
            const mediaHeight = (columnWidth - 2) * ratio;
            // Keep both borders, the 31px metadata bar and the 26px collection button while a card is unloaded.
            // Align column bottoms on the same subpixel grid so equal-height columns stay in reading order.
            const height = Math.round(((source ? Math.min(videoLimit, mediaHeight) : mediaHeight) + 59) * 16) / 16;
            element.style.left = column * (columnWidth + gap) + "px";
            element.style.top = bottoms[column] + "px";
            element.style.height = height + "px";
            bottoms[column] += height + gap;
        }
        grid.style.height = (Math.max(...bottoms) - gap) + "px";
    }

    function append(items) {
        const seen = new Set();
        for (const item of items) {
            if (item?.id == null || seen.has(String(item.id))) continue;
            seen.add(String(item.id));
            const element = document.createElement("div");
            element.className = "cg-slot";
            slots.set(element, { item, source: videoUrl(item), card: null });
        }
        grid.append(...slots.keys());
        layoutCards();
        for (const element of slots.keys()) cardObserver.observe(element);
        return seen.size;
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

    function streamParams(token, ids) {
        const link = linkSource();
        if (link) {
            const params = new URLSearchParams({ nsfw: filters.nsfw, period: "AllTime", sort: "Oldest", include_videos: true,
                min_batch: filters.limit, [link.kind + "Id"]: link.id });
            if (token != null) params.set("cursor", token);
            return "/civitai_gallery/images_stream?" + params;
        }
        const params = new URLSearchParams({
            nsfw: filters.nsfw, sort: ids ? "Newest" : controls.sort.value || filters.sort, period: ids ? "AllTime" : filters.period,
            videos_only: filters.videos_only, hide_no_prompt: filters.hide_no_prompt,
        });
        if (ids) params.set("ids", ids.join(","));
        if (filters.username) params.set("username", filters.username);
        if (filters.tags) params.set("tags", filters.tags);
        if (filters.baseModels) params.set("baseModels", filters.baseModels);
        if (inFavorites()) {
            if (filters.collection) params.set("collection", filters.collection);
            params.set("offset", String(token ?? 0));
            params.set("limit", filters.limit);
            return `/civitai_gallery/get_favorites_images?${params}`;
        }
        const selected = state(node).model;
        if (selected?.id) params.set("modelId", selected.id);
        if (selected?.version?.id) params.set("modelVersionId", selected.version.id);
        params.set("min_batch", filters.limit);
        params.set("include_videos", filters.videos_only);
        if (token != null) params.set("cursor", token);
        return `/civitai_gallery/images_stream?${params}`;
    }

    function renderPager() {
        updateDetailNavigation();
        const random = inShuffle();
        for (const key of ["first", "prev", "numbers", "next"]) find(key).hidden = random;
        find("shuffle").hidden = !random;
        find("shuffle").disabled = Boolean(request);
        if (random) return;
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
            button.setAttribute("aria-label", t("Page {page}", { page: n }));
            if (n === active) button.setAttribute("aria-current", "page");
            button.disabled = busy || n === active;
            button.addEventListener("click", () => loadPage(n));
            numbers.appendChild(button);
        }
    }

    async function restoreDraw(draw, signal) {
        const byId = new Map();
        // Civitai accepts up to 100 IDs per lookup and returns them in server sort order.
        for (let offset = 0; offset < draw.ids.length; offset += 100) {
            signal.throwIfAborted();
            const ids = draw.ids.slice(offset, offset + 100);
            const data = await jsonRequest(streamParams(null, ids), { signal });
            if (!Array.isArray(data?.items)) throw new Error(t("Invalid saved selection response"));
            for (const item of data.items) byId.set(String(item.id), item);
        }
        return { items: draw.ids.map(id => byId.get(id)).filter(Boolean),
            metadata: { nextCursor: draw.next, sampled: draw.sampled } };
    }

    async function loadPage(number, shuffle = false, detailStep = 0) {
        if (removed || !enabled || !visible || request || number < 1 || number > (last ?? starts.length)) return;
        const controller = request = new AbortController();
        retryPage = number;
        retryShuffle = shuffle;
        retry.hidden = true;
        renderPager();
        const random = inShuffle(), savedDraw = random && navigation().pagination?.draw;
        status.textContent = random ? t("Loading random selection…") : t("Loading page {page}…", { page: number });
        let token = inFavorites() ? (number - 1) * Number(filters.limit) : starts[number - 1];
        if (random && shuffle && !inFavorites()) token = savedDraw?.next || null;
        const restoring = savedDraw && !shuffle && Array.isArray(savedDraw.ids) && savedDraw.ids.length > 0 && savedDraw.ids.length <= 150;
        try {
            let data, following, repeated;
            const used = new Set(starts.slice(0, number - 1).map(String));
            // A filtered upstream batch can be empty even though a later batch matches.
            for (let attempt = 0; attempt < 3; attempt++) {
                used.add(String(token));
                data = restoring ? await restoreDraw(savedDraw, controller.signal)
                    : await jsonRequest(streamParams(token), { signal: controller.signal });
                if (controller !== request) return;
                if (!Array.isArray(data?.items) || !data.metadata) throw new Error(t("Invalid gallery response"));
                following = inFavorites() ? data.metadata.nextOffset : data.metadata.nextCursor;
                repeated = following != null && used.has(String(following));
                if (restoring || data.items.length || following == null || repeated) break;
                token = following;
            }
            if (random) {
                last = 1;
            } else if (inFavorites()) {
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
                navigation().scroll_top = 0;
            }
            clearCards();
            const pageChanged = current > 0 && current !== number;
            current = number;
            const pagination = { page: number, starts: [...starts], last };
            if (random) pagination.draw = { ids: [...new Set(data.items.map(item => String(item.id)))],
                next: repeated ? null : following, sampled: Boolean(data.metadata.sampled) };
            navigation().pagination = pagination;
            if (pageChanged || (random && !restoring)) dirty();
            const count = append(data.items);
            const pageLabel = t(last ? "Page {page} / {total} ({count})" : "Page {page} ({count})", { page: number, total: last, count });
            const link = linkSource();
            if (link?.kind === "image" && count && String(data.items[0].id) === link.id && selectedKey !== link.id) {
                select(data.items[0], slots.values().next().value?.card);
            }
            if (details.open && (detailStep || pageChanged || shuffle)) {
                if (count) selectDetail([...slots].at(detailStep < 0 ? -1 : 0));
                else details.close(true);
            }
            status.textContent = random ? t(data.metadata.sampled ? "Shuffled from filtered results" : "Random selection") + " (" + count + ")"
                : repeated ? t("The server returned a repeated page.") : pageLabel;
            if (link && !count) status.textContent = t("No media found. It may be private, removed or outside the current rating.");
            else if (random && !count) status.textContent = t("No matches in this draw. Try Shuffle again or change the filters.");
            else if (!link && !repeated && !count && filters.hide_no_prompt) {
                status.textContent = following == null ? t("No images or videos with a public prompt match these filters.") :
                    t("No public prompt in this batch. Use the next page to keep searching.");
            } else if (!link && !random && !repeated && !count) {
                status.textContent = following == null ? t("No matches for these filters.") : t("No matches in this batch. Try the next page.");
            }
        } catch (error) {
            if (request !== controller) return;
            retry.hidden = false;
            status.textContent = t("Error: {reason}", { reason: error.message });
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
    find("shuffle").addEventListener("click", () => loadPage(1, true));

    function cancel() {
        request?.abort();
        request = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    }

    function clearCards() {
        cardObserver.disconnect();
        for (const [element, slot] of slots) {
            unmount(element, slot);
            element.remove();
        }
        slots.clear();
        currentCard = null;
        grid.style.height = "";
    }

    function reset(top) {
        details.close();
        cancel();
        clearCards();
        const cg = navigation();
        if (top) delete cg.pagination;
        const saved = cg.pagination;
        starts = Array.isArray(saved?.starts) && saved.starts[0] === null &&
            saved.starts.slice(1).every(token => typeof token === "string" || Number.isFinite(token))
            ? [...saved.starts] : [null];
        last = Number.isSafeInteger(saved?.last) && saved.last > 0 ? saved.last : null;
        const available = inFavorites() ? (last || 1) : starts.length;
        retryPage = Number.isSafeInteger(saved?.page) && saved.page > 0 && saved.page <= available ? saved.page : 1;
        current = 0;
        renderPager();
        if (top) {
            restoreTop = 0;
            cg.scroll_top = 0;
        }
        scroll.scrollTop = 0;
        retry.hidden = true;
        status.textContent = "";
        if (enabled && visible && !removed) {
            layoutCards();
            void loadIds();
            void loadPage(retryPage);
        }
    }

    function pause() {
        collections.close();
        cancel();
        restoreTop = restoreTop || navigation().scroll_top || 0;
        cancelSuggestions();
        models.cancel();
        appliedFilters.open = false;
        resources.close();
        details.close();
        library.close();
        idsRequest?.abort();
        idsRequest = null;
        cardObserver.disconnect();
        for (const [element, slot] of slots) unmount(element, slot);
    }

    function resume() {
        if (!visible || !enabled || removed) return;
        if (state(node).panel === "models") models.loadIfNeeded();
        layoutCards();
        for (const element of slots.keys()) cardObserver.observe(element);
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
        if (!on) {
            pause();
            clearCards();
            retryPage = current || retryPage;
            current = 0;
            favoriteIds = null;
            changedIds.clear();
            favoriteStatus.textContent = "";
        }
        renderButton.classList.toggle("cg-render-on", on);
        renderButton.classList.toggle("cg-render-off", !on);
        renderButton.setAttribute("aria-pressed", String(on));
        renderButton.textContent = t(on ? "Display: ON" : "Display: OFF");
        renderButton.title = t(on ? "Turn off and unload all gallery previews" : "Reload previews for this page");
        find("collection-path").classList.toggle("paused", !on);
        scroll.classList.toggle("paused", !on);
        foot.classList.toggle("paused", !on);
        if (on) resume();
    }

    function renderToggles() {
        const model = state(node).model;
        const needsVersion = !linkSource() && !inFavorites() && model?.id && !model.version?.id &&
            ["Most Collected", "Most Comments", "Most Reactions"].includes(filters.sort);
        models.setOnline(!inFavorites(), needsVersion);
        // The public image record has no collection count to sort local favorites by.
        find("collected").disabled = filters.favorites_only;
        collectionEntry.hidden = !inFavorites() || Boolean(filters.collection);
        collections.updatePath();
        controls.sort.value = filters.favorites_only && filters.sort === "Most Collected" ? "Newest" : filters.sort;
        for (const [key, button] of Object.entries(toggles)) {
            const active = key === "favorites_only" ? inFavorites() : filters[key];
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        renderAppliedFilters(needsVersion ? "Newest (all versions)" : controls.sort.value);
    }

    function renderAppliedFilters(sort) {
        const rows = [];
        const link = linkSource();
        if (!link) {
            if (inFavorites()) rows.push(["Source", t("Favorites"), t("Favorites")]);
            if (inFavorites() && filters.collection) rows.push(["Collection", filters.collection]);
            const model = !inFavorites() && state(node).model;
            if (model?.id) rows.push(["Model", models.selectedLabel()]);
            if (model?.version?.id) rows.push(["Version", model.version.label || "#" + model.version.id]);
            if (filters.baseModels) rows.push(["Base model", filters.baseModels]);
            if (filters.username) rows.push(["Creator", filters.username]);
            if (filters.hide_no_prompt) rows.push(["Prompt", t("With prompt"), t("With prompt")]);
            if (filters.period !== "AllTime") rows.push(["Period", t(filters.period)]);
        }
        const media = t(link ? "Images and videos" : filters.videos_only ? "Videos" : "Images");
        rows.push(["Media", media, media], ["NSFW", t(filters.nsfw)]);
        if (!link) rows.push(["Sort", t(sort), t(sort)]);
        const brief = find("applied-brief");
        brief.textContent = rows.map(([label, value, short]) => short || t("{label}: {value}", { label: t(label), value })).join(" · ");
        const list = find("applied-list");
        list.replaceChildren();
        for (const [label, value] of rows) {
            const term = document.createElement("dt"), description = document.createElement("dd");
            term.textContent = t(label);
            description.textContent = value;
            list.append(term, description);
        }
    }
    function positionFilterDetails() {
        const above = find("header").clientHeight, below = find("body").clientHeight;
        const upwards = below < 136 && above > below;
        appliedFilters.classList.toggle("cg-opens-up", upwards);
        appliedFilters.style.setProperty("--cg-applied-max-height", Math.min(136, upwards ? above : below) + "px");
    }
    find("applied-toggle").addEventListener("click", () => {
        if (!appliedFilters.open) positionFilterDetails();
    });
    appliedFilters.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !appliedFilters.open) return;
        event.stopPropagation();
        appliedFilters.open = false;
        find("applied-toggle").focus();
    });
    root.addEventListener("pointerdown", event => {
        if (appliedFilters.open && !appliedFilters.contains(event.target)) appliedFilters.open = false;
    }, { capture: true });

    function renderTags() {
        const selected = filters.tags.split(",").filter(Boolean);
        const chips = find("tag-chips");
        chips.replaceChildren();
        for (const [id, option] of tagOptions) option.disabled = selected.includes(id);
        for (const id of selected) {
            const name = tagOptions.get(id)?.textContent || "#" + id;
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cg-tag-chip";
            chip.textContent = name + " ×";
            chip.setAttribute("aria-label", t("Remove tag {name}", { name }));
            chip.addEventListener("click", () => {
                filters.tags = filters.tags.split(",").filter(value => value !== id).join(",");
                applyFilters();
                tags.focus();
            });
            chips.appendChild(chip);
        }
        tags.value = "";
    }

    function renderSource() {
        const link = linkSource();
        find("saved-toggle").hidden = Boolean(link) || find("panel-filters").hidden;
        find("panel-filters").classList.toggle("cg-linked", Boolean(link));
        find("link-source").hidden = !link;
        find("link-label").textContent = link ? t(link.kind === "image" ? "Image #{id}" : "Post #{id}", { id: link.id }) : "";
        find("tab-link").classList.toggle("cg-has-model", Boolean(link));
    }
    function openLink() {
        const link = readMediaLink(linkInput.value);
        const message = find("link-status");
        if (!link) {
            message.textContent = t("Enter a Civitai image or post URL.");
            linkInput.setAttribute("aria-invalid", "true");
            linkInput.focus();
            return;
        }
        linkInput.removeAttribute("aria-invalid");
        message.textContent = "";
        navigation().scroll_top = restoreTop || scroll.scrollTop;
        state(node).link = link;
        resources.close();
        renderSource();
        renderToggles();
        reset(true);
        if (!enabled) {
            state(node).display_on = true;
            display(true);
        }
        dirty();
    }
    find("open-link").addEventListener("click", openLink);
    linkInput.addEventListener("input", () => {
        linkInput.removeAttribute("aria-invalid");
        find("link-status").textContent = "";
    });
    linkInput.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); openLink(); }
    });
    find("back-gallery").addEventListener("click", () => {
        const cg = state(node);
        delete cg.link;
        linkInput.value = "";
        renderSource();
        renderToggles();
        showPanel("filters");
        cg.panel = "filters";
        restoreTop = cg.scroll_top || 0;
        reset(false);
        dirty();
    });

    function setThumbnailWidth(value) {
        thumb.value = ["160", "220", "280", "400"].includes(value) ? value : "280";
        find("root").style.setProperty("--cg-folder-width", thumb.value + "px");
        layoutCards();
        schedule();
    }

    thumb.addEventListener("change", () => {
        setThumbnailWidth(thumb.value);
        state(node).thumbnail_width = thumb.value;
        dirty();
    });

    resolution.addEventListener("change", () => {
        state(node).preview_resolution = resolution.value;
        details.close();
        if (collections.exploring) void collections.load();
        for (const [element, slot] of slots) {
            if (slot.card) { unmount(element, slot); mount(element, slot); }
        }
        dirty();
    });


    function restoreFilterControls() {
        models.restore(filters.baseModels);
        for (const [key, input] of Object.entries(controls)) {
            input.value = filters[key];
            if (!input.value && key !== "username" && key !== "baseModels" && input.options?.length) {
                input.selectedIndex = 0;
                filters[key] = input.value;
            }
        }
    }

    function configure(savedSelection) {
        const cg = state(node);
        if (cg.link && (!(cg.link.kind === "post" || cg.link.kind === "image") || !/^[1-9]\d*$/.test(cg.link.id))) delete cg.link;
        filters = galleryOptions(node);
        showPanel(panels.includes(cg.panel) ? cg.panel : "filters");
        restoreFilterControls();
        linkInput.value = cg.link ? "https://civitai.com/" + cg.link.kind + "s/" + cg.link.id : "";
        linkInput.removeAttribute("aria-invalid");
        find("link-status").textContent = "";
        renderSource();
        renderTags();
        resolution.value = ["256", "768", "1024", "original"].includes(cg.preview_resolution) ? cg.preview_resolution : "512";
        setThumbnailWidth(cg.thumbnail_width);
        const selection = galleryWidget(node);
        if (typeof savedSelection === "string") selection.value = savedSelection;
        else if (typeof cg.selection_data === "string") selection.value = cg.selection_data;
        delete cg.selection_data;
        try {
            showSelection(JSON.parse(selection.value || "{}")?.item);
        } catch { showSelection(null); }
        renderToggles();
        restoreTop = Number(navigation().scroll_top) || 0;
        enabled = cg.display_on !== false;
        reset(false);
        display(enabled);
    }

    function applyFilters(event) {
        const cg = state(node);
        if (linkSource()) {
            if (event?.target === controls.limit || event?.target === controls.nsfw) {
                delete cg.pagination;
                cg.scroll_top = 0;
            }
            else { delete cg.link; renderSource(); }
        }
        for (const [key, input] of Object.entries(controls)) {
            if (key === "sort" && find("collected").disabled && filters.sort === "Most Collected" && event?.target !== input) continue;
            filters[key] = input.value.trim();
        }
        if (tags.value) filters.tags = [...new Set([...filters.tags.split(",").filter(Boolean), tags.value])].join(",");
        commitFilters();
    }
    function commitFilters() {
        cancelSuggestions();
        renderTags();
        state(node).filters = { ...filters };
        renderToggles();
        reset(true);
        dirty();
    }
    for (const [key, input] of Object.entries(controls)) {
        if (key !== "username") input.addEventListener("change", applyFilters);
    }
    tags.addEventListener("change", applyFilters);
    controls.username.addEventListener("keydown", e => { if (e.key === "Enter") applyFilters(); });
    find("search").addEventListener("click", applyFilters);
    for (const [key, button] of Object.entries(toggles)) {
        button.addEventListener("click", () => {
            if (key === "favorites_only") { library.close(); collections.close(); }
            filters[key] = key === "favorites_only" ? !inFavorites() : !filters[key];
            applyFilters();
        });
    }
    find("refresh").addEventListener("click", () => {
        if (collections.exploring) { void collections.load(); return; }
        favoriteIds = null;
        idsRequest?.abort();
        idsRequest = null;
        if (linkSource() || inShuffle()) {
            if (enabled && visible) { void loadIds(); void loadPage(inShuffle() ? 1 : current || 1, inShuffle()); }
        } else applyFilters();
    });
    retry.addEventListener("click", () => {
        void loadPage(retryPage, retryShuffle);
    });
    renderButton.addEventListener("click", () => {
        state(node).display_on = !enabled;
        display(!enabled);
        dirty();
    });

    scroll.addEventListener("scroll", () => {
        collections.onScroll();
        if (!enabled || !visible || removed) return;
        if (!restoreTop) navigation().scroll_top = scroll.scrollTop;
        schedule();
    }, { passive: true });
    // Nodes 2.0 intercepts wheel events on a canvas ancestor during capture, before the widget sees them.
    function keepGalleryWheel(event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !event.deltaY ||
            Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const region = wheelRegions.find(el => event.composedPath().includes(el));
        if (!region || region.scrollHeight <= region.clientHeight) return;
        if (region === scroll) restoreTop = 0;
        event.stopPropagation(); // The browser still performs the native scroll.
    }
    const releaseWheel = () => document.removeEventListener("wheel", keepGalleryWheel, { capture: true });
    const wheelRegions = [scroll, find("resources"), find("tag-chips"), find("applied-list"),
        find("detail-notes"), find("detail-media"), find("library"), find("explorer-scroll"), find("collection-menu")];
    for (const region of wheelRegions) {
        region.addEventListener("pointerenter", () => {
            document.addEventListener("wheel", keepGalleryWheel, { capture: true, passive: true });
        });
        region.addEventListener("pointerleave", releaseWheel);
    }
    scroll.addEventListener("pointerdown", () => { restoreTop = 0; }, { passive: true });
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
        if (resizeFrame) return;
        // Repacking cards can change the observed scrollbar width.
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            collections.position();
            if (appliedFilters.open) positionFilterDetails();
            layoutCards();
            schedule();
        });
    });
    resize.observe(scroll);
    resize.observe(document.documentElement);
    const previousResize = node.onResize;
    node.onResize = function (size) {
        size[0] = Math.max(720, size[0]);
        size[1] = Math.max(420, size[1]);
        return previousResize?.call(this, size) ?? size;
    };

    function dispose() {
        removed = true;
        releaseWheel();
        pause();
        storage.dispose();
        collections.dispose();
        library.dispose();
        favoriteChanges.removeEventListener("collections", collectionChanged);
        viewport.disconnect();
        resize.disconnect();
        cancelAnimationFrame(resizeFrame);
        favoriteChanges.removeEventListener("change", favoriteChanged);
        clearCards();
    }
    configure();
    return { configure, dispose };
}

app.registerExtension({
    name: EXT_NAME,
    beforeConfigureGraph() { return loadHubLanguage(app, document); },
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
                if (data.properties.__cg) {
                    const cg = data.properties.__cg = { ...data.properties.__cg };
                    if (cg.link) cg.link = { ...cg.link };
                }
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
        return loadHubLanguage(app, document);
    },
});
