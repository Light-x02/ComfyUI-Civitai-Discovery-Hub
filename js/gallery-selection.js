const CIVITAI_SITES = new Set(["civitai.com", "civitai.red", "civitai.green", "civitai.work"]);

export function readMediaLink(text) {
    let url;
    try { url = new URL(text.trim()); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !CIVITAI_SITES.has(url.hostname.replace(/^www\./, ""))) return null;
    const match = /^\/(images|posts)\/([1-9]\d*)(?:\/[^/]*)?\/?$/.exec(url.pathname);
    if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
    return { kind: match[1] === "images" ? "image" : "post", id: match[2] };
}

function listedResources(item) {
    const rows = new Map();
    const meta = item?.meta || {};
    const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
    function add(resource) {
        if (!resource || typeof resource !== "object") return;
        const id = positiveId(resource.modelVersionId) ? String(resource.modelVersionId) : "";
        const name = typeof resource.name === "string" ? resource.name.trim() : "";
        if (!id && !name) return;
        const modelId = positiveId(resource.modelId) ? String(resource.modelId) : "";
        const key = id || (resource.type || "") + "/" + name.toLowerCase();
        const row = rows.get(key) || { id, name: "", type: "", weight: null, modelId: "" };
        row.name ||= name;
        row.type ||= typeof resource.type === "string" ? resource.type : "";
        row.modelId ||= modelId;
        const weight = typeof resource.weight === "string" && resource.weight.trim() ? Number(resource.weight) : resource.weight;
        if (row.weight == null && Number.isFinite(weight)) row.weight = weight;
        rows.set(key, row);
    }
    if (Array.isArray(meta.civitaiResources)) meta.civitaiResources.forEach(add);
    if (Array.isArray(meta.resources)) meta.resources.forEach(add);
    if (Array.isArray(item?.modelVersionIds)) item.modelVersionIds.forEach(modelVersionId => add({ modelVersionId }));
    const checkpoint = [meta.Model, meta.model].find(value => typeof value === "string" && value.trim());
    if (checkpoint) {
        const checkpoints = [...rows.values()].filter(row => row.type.toLowerCase() === "checkpoint");
        if (!checkpoints.length) add({ type: "checkpoint", name: checkpoint });
        else if (checkpoints.length === 1 && !checkpoints[0].name) checkpoints[0].name = checkpoint.trim();
    }
    return [...rows.values()];
}

export function resourcePanel(doc, find, request, t) {
    const button = find("resource-toggle"), panel = find("resources"), list = find("resource-list");
    let rows = [], pending;
    function close() {
        pending?.abort();
        pending = null;
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
        list.replaceChildren();
    }
    function open() {
        close();
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        const unresolved = [];
        for (const row of rows) {
            const li = doc.createElement("li");
            const type = doc.createElement("span");
            type.className = "cg-resource-type";
            type.textContent = ({ lora: "LoRA", checkpoint: t("Checkpoint") })[row.type.toLowerCase()] || row.type || t("Model");
            const target = doc.createElement(row.id || row.modelId ? "a" : "span");
            target.textContent = row.name || t("Version #{id}", { id: row.id });
            if (row.id || row.modelId) {
                target.href = row.id ? "https://civitai.com/model-versions/" + row.id : "https://civitai.com/models/" + row.modelId;
                target.target = "_blank";
                target.rel = "noopener noreferrer";
            }
            li.append(type, target);
            if (row.weight != null) {
                const weight = doc.createElement("span");
                weight.className = "cg-resource-weight";
                weight.textContent = t("Weight {weight}", { weight: row.weight });
                li.appendChild(weight);
            }
            list.appendChild(li);
            if (row.id && !row.name) unresolved.push({ row, target });
        }
        if (!unresolved.length) return;
        const controller = pending = new AbortController();
        async function resolveNames() {
            while (unresolved.length && !controller.signal.aborted) {
                const { row, target } = unresolved.shift();
                try {
                    const data = await request("/civitai_gallery/catalog/resource?" + new URLSearchParams({ id: row.id }), { signal: controller.signal });
                    if (controller.signal.aborted || !data.name) continue;
                    row.name = [data.name, data.version].filter(Boolean).join(" · ");
                    target.textContent = row.name;
                } catch { /* The version link remains usable without its display name. */ }
            }
        }
        void resolveNames();
        void resolveNames();
    }
    button.addEventListener("click", () => panel.hidden ? open() : close());
    return {
        close,
        select(item) {
            const wasOpen = !panel.hidden;
            close();
            rows = listedResources(item);
            button.hidden = !item;
            button.disabled = !rows.length;
            button.textContent = t(rows.length ? "Resources ({count})" : "Resources", { count: rows.length });
            button.title = t(rows.length ? "Models and LoRAs used by this media" : "No resources published for this item");
            if (wasOpen && rows.length) open();
        },
    };
}
