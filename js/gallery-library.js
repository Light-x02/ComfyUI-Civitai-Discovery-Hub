export function galleryLibrary(doc, find, request, changes, gallery, t) {
    const panel = find("library"), toggle = find("saved-toggle"), select = find("library-select"), input = find("library-name");
    const status = find("library-status"), create = find("library-create"), apply = find("library-apply");
    const update = find("library-update"), del = find("library-delete");
    let reading = null, writing = false, ready = false, items = [], search = "";

    function controls() {
        const busy = writing || !ready;
        select.disabled = busy || !items.length;
        input.disabled = busy;
        create.disabled = busy || !input.value.trim();
        del.disabled = apply.disabled = update.disabled = busy || !items.some(item => item.name === select.value);
    }
    function close(focus = false) {
        if (panel.hidden) return;
        reading?.abort();
        reading = null;
        ready = false;
        panel.hidden = true;
        find("root").classList.remove("cg-library-open");
        toggle.setAttribute("aria-expanded", "false");
        select.replaceChildren();
        items = [];
        if (focus) toggle.focus({ preventScroll: true });
    }
    async function load() {
        if (panel.hidden) return;
        reading?.abort();
        const controller = reading = new AbortController();
        ready = false;
        controls();
        try {
            const data = await request("/civitai_gallery/searches", { signal: controller.signal });
            if (reading !== controller) return;
            if (!Array.isArray(data?.items)) throw new Error(t("Could not read the saved searches."));
            items = data.items;
            if (!items.some(row => row.name === search)) search = "";
            select.replaceChildren();
            for (const name of ["", ...items.map(row => row.name)]) {
                const option = doc.createElement("option");
                option.value = name;
                option.textContent = name || t("Choose a search…");
                select.appendChild(option);
            }
            select.value = search;
            ready = true;
            controls();
        } catch (error) {
            if (reading === controller) status.textContent = error.message;
        } finally {
            if (reading === controller) reading = null;
        }
    }
    async function edit(body) {
        if (panel.hidden || writing || !ready) return;
        writing = true;
        status.textContent = "";
        controls();
        try {
            await request("/civitai_gallery/searches", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body) });
            search = body.action === "delete" ? "" : body.name;
            if (!panel.hidden) {
                if (body.action === "create") input.value = "";
                status.textContent = t({ create: "Search saved.", update: "Search updated.", delete: "Search deleted." }[body.action]);
            }
            changes.dispatchEvent(new Event("searches"));
        } catch (error) {
            if (!panel.hidden) { status.textContent = error.message; void load(); }
        } finally { writing = false; controls(); }
    }
    panel.hidden = true;
    toggle.addEventListener("click", () => {
        if (!panel.hidden) { close(true); return; }
        gallery.onOpen();
        input.value = status.textContent = "";
        toggle.setAttribute("aria-expanded", "true");
        panel.hidden = false;
        find("root").classList.add("cg-library-open");
        find("library-close").focus({ preventScroll: true });
        void load();
    });
    select.addEventListener("change", () => { search = select.value; status.textContent = ""; controls(); });
    apply.addEventListener("click", () => {
        const row = items.find(item => item.name === select.value);
        if (row) { close(true); gallery.apply(row.settings); }
    });
    create.addEventListener("click", () => { void edit({ action: "create", name: input.value.trim(), settings: gallery.snapshot() }); });
    update.addEventListener("click", () => { void edit({ action: "update", name: select.value, settings: gallery.snapshot() }); });
    del.addEventListener("click", () => {
        if (doc.defaultView.confirm(t("Delete saved search “{name}”?", { name: select.value }))) void edit({ action: "delete", name: select.value });
    });
    input.addEventListener("input", controls);
    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && !create.disabled) { event.preventDefault(); create.click(); }
    });
    find("library-close").addEventListener("click", () => close(true));
    panel.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    });
    changes.addEventListener("searches", load);
    return { close, dispose() { close(); changes.removeEventListener("searches", load); } };
}
