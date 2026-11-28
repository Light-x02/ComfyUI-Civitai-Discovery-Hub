export function storagePanel(doc, find, request, changes, t) {
    const input = find("folder"), list = find("folder-list"), status = find("folder-status");
    const browse = find("folder-browse"), reset = find("folder-default"), save = find("folder-save");
    const endpoint = "/civitai_gallery/storage";
    let info = null, saving = false, revision = 0;

    function folderPath() {
        return input.value.trim() === info.defaultLabel ? info.defaultFolder : input.value.trim();
    }
    function controls() {
        input.disabled = browse.disabled = saving || !info;
        reset.disabled = input.disabled || folderPath() === info.defaultFolder;
        save.disabled = input.disabled || !folderPath() || folderPath() === info.folder;
    }
    function message(text, error = false) {
        status.textContent = text;
        if (error) status.dataset.error = "";
        else delete status.dataset.error;
    }
    function closeList() {
        list.hidden = true;
        browse.setAttribute("aria-expanded", "false");
    }
    function showLocation(data) {
        info = data;
        input.value = data.folder === data.defaultFolder ? data.defaultLabel : data.folder;
        closeList();
        controls();
    }
    function edit() {
        ++revision;
        closeList();
        controls();
        message(save.disabled ? "" : t("Save to move your favorites, collections and saved searches to this folder."));
    }
    async function load() {
        if (saving) return;
        const ticket = ++revision;
        info = null;
        input.value = "";
        closeList();
        controls();
        message(t("Loading favorites folder…"));
        try {
            const data = await request(endpoint);
            if (ticket !== revision) return;
            showLocation(data);
            message("");
        } catch (error) {
            if (ticket === revision) message(error.message, true);
        }
    }
    async function folders(path) {
        const ticket = ++revision;
        closeList();
        message(t("Reading folders…"));
        try {
            const data = await request(endpoint + "?" + new URLSearchParams({ browse: path }));
            if (ticket !== revision) return;
            input.value = data.folder;
            function option(label, value) {
                const el = doc.createElement("option");
                el.textContent = label;
                el.value = value;
                return el;
            }
            list.replaceChildren(option(t("Choose a folder…"), ""));
            if (data.parent !== data.folder) list.appendChild(option(t("↑ Parent folder"), data.parent));
            for (const child of data.children) list.appendChild(option(child.name, child.path));
            for (const drive of data.drives) list.appendChild(option(drive, drive));
            list.value = "";
            list.hidden = false;
            browse.setAttribute("aria-expanded", "true");
            list.focus();
            controls();
            message(t("Choose a subfolder, or save the folder shown above."));
        } catch (error) {
            if (ticket === revision) message(error.message, true);
        }
    }
    function changed(event) {
        ++revision;
        showLocation(event.detail);
        message(t("Favorites folder saved."));
    }
    changes.addEventListener("storage", changed);
    save.addEventListener("click", async () => {
        if (saving || save.disabled) return;
        ++revision;
        saving = true;
        closeList();
        controls();
        message(t("Moving favorites…"));
        try {
            const data = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder: folderPath() }) });
            changes.dispatchEvent(new CustomEvent("storage", { detail: data }));
        } catch (error) {
            message(error.message, true);
        } finally {
            saving = false;
            controls();
        }
    });
    browse.addEventListener("click", () => {
        if (!list.hidden) edit();
        else void folders(folderPath() || info.folder);
    });
    list.addEventListener("change", () => { if (list.value) void folders(list.value); });
    reset.addEventListener("click", () => { input.value = info.defaultLabel; edit(); });
    input.addEventListener("input", edit);
    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); save.click(); }
    });
    return { load, dispose() { ++revision; changes.removeEventListener("storage", changed); } };
}
