const POSITIVE = ["prompt", "Prompt", "positive", "positivePrompt", "textPrompt"];
const NEGATIVE = ["negativePrompt", "NegativePrompt", "negative"];
const PARAMETERS = [
    ["Model", "Model", "model"], ["Sampler", "sampler", "Sampler"], ["Scheduler", "scheduler", "Schedule type"],
    ["Steps", "steps", "Steps"], ["CFG scale", "cfgScale", "CFG scale", "cfg_scale"],
    ["Seed", "seed", "Seed"], ["Size", "Size", "size"], ["Clip skip", "clipSkip", "Clip skip"],
    ["Denoising strength", "denoisingStrength", "Denoising strength"], ["VAE", "VAE", "vae"],
];

export function detailPanel(doc, find, onOpen, step, previews, t) {
    const panel = find("inspector"), toggle = find("detail-toggle"), media = find("detail-media");
    const notes = find("detail-notes"), enlarge = find("detail-enlarge"), status = find("copy-status");
    const more = find("extra-parameters"), json = find("extra-json");
    let original = "", preview = "", video = "", revision = 0;
    let extra = null;
    more.addEventListener("toggle", () => { json.textContent = more.open && extra ? JSON.stringify(extra, null, 2) : ""; });

    function releaseMedia() {
        const player = media.querySelector("video");
        if (player) {
            player.pause();
            player.removeAttribute("src");
            previews.release(player);
            player.load();
        }
        previews.release(media.querySelector("img"));
        media.replaceChildren();
    }
    function close(focus = false) {
        if (panel.hidden) return;
        ++revision;
        panel.hidden = true;
        find("root").classList.remove("cg-inspecting");
        find("scroll").inert = false;
        toggle.setAttribute("aria-expanded", "false");
        releaseMedia();
        original = preview = video = "";
        find("positive-text").textContent = find("negative-text").textContent = "";
        find("parameters").replaceChildren();
        more.open = false;
        json.textContent = "";
        extra = null;
        if (focus) toggle.focus({ preventScroll: true });
    }
    function expanded(on) {
        panel.classList.toggle("cg-enlarged", on);
        notes.hidden = on;
        enlarge.setAttribute("aria-pressed", String(on));
        enlarge.textContent = t(on ? "Back to details" : video ? "Play video" : "Enlarge");
        enlarge.title = t(on ? "Return to the preview" : video ? "Load and play the video" : "View the original image at full size");
    }
    function showMedia(on) {
        expanded(on);
        if (on && video) {
            releaseMedia();
            const player = doc.createElement("video");
            player.controls = true;
            player.playsInline = true;
            if (preview) previews.show(player, preview, "poster");
            player.addEventListener("error", () => {
                if (media.querySelector("video") !== player) return;
                showMedia(false);
                status.textContent = t("Video unavailable.");
            });
            player.src = video;
            media.appendChild(player);
            void player.play().catch(() => {});
            return;
        }
        const src = on ? original : preview;
        let image = media.querySelector("img");
        if (!image || !src) {
            releaseMedia();
            if (!src) { media.textContent = t(video ? "No video poster available." : "Preview unavailable."); return; }
            image = doc.createElement("img");
            image.addEventListener("error", () => {
                if (media.querySelector("img") !== image) return;
                if (notes.hidden && preview && preview !== original) {
                    showMedia(false);
                    status.textContent = t("Original image unavailable. Showing the preview.");
                } else {
                    releaseMedia();
                    media.textContent = t("Image unavailable.");
                }
            });
            media.appendChild(image);
        }
        image.alt = find("detail-title").textContent;
        previews.show(image, src);
    }
    function show(item, sources) {
        if (panel.hidden) return;
        ++revision;
        releaseMedia();
        ({ original, preview, video } = sources);
        const meta = item.meta || {};
        const params = meta.meta && typeof meta.meta === "object" && Object.keys(meta).every(k => k === "meta" || k === "id") ? meta.meta : meta;
        extra = { ...params };
        for (const key of [...POSITIVE, ...NEGATIVE]) delete extra[key];
        more.open = false;
        json.textContent = "";
        find("detail-title").textContent = t(video || item.type === "video" ? "Video #{id}" : "Image #{id}", { id: item.id });
        for (const [kind, keys] of [["positive", POSITIVE], ["negative", NEGATIVE]]) {
            const value = keys.map(key => params[key]).find(v => typeof v === "string" && v.trim());
            const text = find(kind + "-text");
            text.textContent = value || t("Not published.");
            text.classList.toggle("cg-missing", !value);
            find("copy-" + kind).disabled = !value;
            find("copy-" + kind).textContent = t("Copy");
        }
        const list = find("parameters");
        list.replaceChildren();
        for (const [label, ...keys] of PARAMETERS) {
            let value = keys.map(key => params[key]).find(v => typeof v === "number" || (typeof v === "string" && v.trim()));
            if (value != null) for (const key of keys) delete extra[key];
            if (value == null && label === "Size" && item.width && item.height) value = item.width + " × " + item.height;
            if (value == null) continue;
            const term = doc.createElement("dt"), content = doc.createElement("dd");
            term.textContent = t(label);
            content.textContent = String(value);
            list.append(term, content);
        }
        more.hidden = !Object.keys(extra).length;
        find("no-parameters").hidden = list.children.length > 0 || !more.hidden;
        status.textContent = "";
        notes.scrollTop = 0;
        enlarge.hidden = !(original || video);
        showMedia(false);
    }
    for (const kind of ["positive", "negative"]) {
        find("copy-" + kind).addEventListener("click", async () => {
            const text = find(kind + "-text"), ticket = revision;
            try {
                let copied = false;
                if (doc.defaultView?.navigator.clipboard?.writeText) {
                    try {
                        await doc.defaultView.navigator.clipboard.writeText(text.textContent);
                        copied = true;
                    } catch { /* Some ComfyUI hosts only allow copying the current selection. */ }
                }
                if (!copied) {
                    if (ticket !== revision) return;
                    const range = doc.createRange(), selection = doc.getSelection();
                    range.selectNodeContents(text);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    if (!doc.execCommand("copy")) throw new Error();
                    selection.removeAllRanges();
                }
                if (ticket === revision) {
                    find("copy-" + kind).textContent = t("Copied");
                    status.textContent = t("Prompt copied.");
                }
            } catch {
                if (ticket === revision) status.textContent = t("Select the prompt text and copy it manually.");
            }
        });
    }
    enlarge.addEventListener("click", () => showMedia(!notes.hidden));
    toggle.addEventListener("click", () => {
        if (!panel.hidden) { close(true); return; }
        panel.hidden = false;
        find("root").classList.add("cg-inspecting");
        toggle.setAttribute("aria-expanded", "true");
        find("scroll").inert = true;
        onOpen();
        panel.focus({ preventScroll: true });
    });
    find("detail-close").addEventListener("click", () => close(true));
    for (const [name, delta] of [["prev", -1], ["next", 1]]) {
        find("detail-" + name).addEventListener("click", () => step(delta));
    }
    panel.addEventListener("keydown", event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "Escape") close(true);
        else if (["ArrowLeft", "ArrowRight"].includes(event.key) && event.target.tagName !== "VIDEO") {
            step(event.key === "ArrowLeft" ? -1 : 1);
        } else return;
        event.preventDefault();
        event.stopPropagation();
    });
    panel.hidden = true;
    return { close, show, get open() { return !panel.hidden; } };
}
