export function collectionExplorer(doc, find, request, changes, gallery, t) {
    const panel = find("explorer"), grid = find("collection-grid"), scroll = find("scroll");
    const toggle = find("collections-toggle"), menu = find("collection-menu"), rows = find("memberships");
    const entry = find("collections-entry"), path = find("collection-path"), currentFolder = find("current-collection");
    const root = find("root"), menuNew = find("menu-new");
    let surface = null, reading = null, writing = false, ready = false;
    let items = [], favorite = false, form = null;
    const covers = new doc.defaultView.IntersectionObserver(entries => {
        for (const { target, isIntersecting } of entries) {
            if (panel.hidden || !grid.contains(target)) continue;
            if (isIntersecting) gallery.cover(target, target.dataset.cover);
            else gallery.release(target);
        }
    }, { root: find("explorer-scroll"), rootMargin: "200px" });

    function button(cls, label) {
        const el = doc.createElement("button");
        el.type = "button";
        el.className = cls;
        el.textContent = label;
        return el;
    }
    find("all-favorites").textContent = t("All favorites");
    find("explorer-close").setAttribute("aria-label", t("Close"));
    menuNew.textContent = "+ " + t("New collection");
    menu.setAttribute("aria-label", t("Add to a collection"));
    menu.tabIndex = -1;
    panel.hidden = menu.hidden = true;

    const inMenu = () => Boolean(surface?.item);
    const message = () => find(inMenu() ? "menu-status" : "explorer-status");
    function updatePath() {
        const exploring = Boolean(surface && !inMenu()), name = gallery.folder();
        path.hidden = !exploring && !name;
        find("collection-parent").hidden = exploring;
        find("explorer-close").hidden = !exploring;
        currentFolder.textContent = exploring ? t("Collections") : name;
        currentFolder.title = currentFolder.textContent;
    }
    function position() {
        if (!inMenu()) return;
        const anchor = surface.button;
        const rect = anchor.getBoundingClientRect(), box = root.getBoundingClientRect();
        const sx = box.width / root.offsetWidth || 1, sy = box.height / root.offsetHeight || 1;
        const below = (box.bottom - rect.bottom) / sy, above = (rect.top - box.top) / sy;
        const up = below < Math.min(240, menu.scrollHeight + 8) && above > below;
        menu.style.maxHeight = Math.max(0, Math.min(320, root.clientHeight - 4)) + "px";
        menu.style.left = Math.max(2, Math.min((rect.left - box.left) / sx - root.clientLeft, root.clientWidth - menu.offsetWidth - 2)) + "px";
        const top = up ? above - menu.offsetHeight - 2 : (rect.bottom - box.top) / sy + 2;
        menu.style.top = Math.max(2, Math.min(top - root.clientTop, root.clientHeight - menu.offsetHeight - 2)) + "px";
    }
    function releaseTiles() {
        covers.disconnect();
        for (const image of grid.querySelectorAll("img")) gallery.release(image);
        grid.replaceChildren();
    }
    function closeForm() {
        if (form) { form.parentNode.replaceChildren(); form = null; }
        menuNew.hidden = false;
    }
    function outside(event) {
        if (inMenu() && !menu.contains(event.target) && !surface.button.contains(event.target)) close();
    }
    function close(focus = false) {
        if (!surface) return;
        const opener = surface.button, explorer = !inMenu();
        reading?.abort();
        reading = null;
        if (explorer) {
            releaseTiles();
            scroll.inert = false;
            root.classList.remove("cg-exploring");
        }
        doc.removeEventListener("pointerdown", outside, true);
        closeForm();
        panel.hidden = menu.hidden = true;
        opener.setAttribute("aria-expanded", "false");
        rows.replaceChildren();
        surface = null;
        items = [];
        ready = false;
        if (explorer) updatePath();
        if (focus) {
            const target = explorer ? (gallery.folder() ? toggle : entry) : opener;
            target.focus({ preventScroll: true });
        }
    }
    function openFolder(name) {
        close();
        gallery.onOpen();
        gallery.browse(name);
        (name ? toggle : entry).focus({ preventScroll: true });
    }
    function controls() {
        const busy = writing || !ready;
        for (const el of rows.querySelectorAll("button")) el.disabled = busy || el.dataset.current === "true";
        for (const el of grid.querySelectorAll(".cg-tile-delete")) el.disabled = busy;
        menuNew.disabled = busy;
        if (form) {
            const input = form.querySelector("input");
            input.disabled = writing;
            form.querySelector(".cg-create-folder").disabled = busy || !input.value.trim();
        }
    }
    function showForm() {
        if (!surface || writing) return;
        if (form) { form.querySelector("input").focus(); return; }
        form = doc.createElement("form");
        form.className = "cg-collection-form";
        const input = doc.createElement("input"), save = button("cg-btn cg-create-folder", t("Create"));
        input.type = "text";
        input.className = "cg-input cg-collection-name";
        input.placeholder = t("Collection name");
        input.setAttribute("aria-label", input.placeholder);
        input.autocomplete = "off";
        input.maxLength = 80;
        save.type = "submit";
        const cancel = button("cg-btn", t("Cancel"));
        cancel.addEventListener("click", () => { closeForm(); (inMenu() ? menuNew : grid.querySelector(".cg-new-tile"))?.focus(); });
        form.append(input, save, cancel);
        find(inMenu() ? "menu-editor" : "explorer-editor").appendChild(form);
        menuNew.hidden = inMenu();
        form.addEventListener("submit", event => {
            event.preventDefault();
            if (!save.disabled) void edit("create", input.value.trim());
        });
        input.addEventListener("input", controls);
        controls();
        position();
        input.focus();
    }
    function renderFolders() {
        const focused = doc.activeElement?.dataset?.folder;
        releaseTiles();
        function tile(name, isNew) {
            const el = button("cg-folder-tile" + (isNew ? " cg-new-tile" : ""), "");
            el.dataset.folder = name;
            const plate = doc.createElement("span");
            plate.className = "cg-folder-name";
            plate.textContent = name;
            el.appendChild(plate);
            el.addEventListener("click", isNew ? showForm : () => openFolder(name));
            return el;
        }
        const add = tile(t("New collection"), true), plus = doc.createElement("span");
        plus.setAttribute("aria-hidden", "true");
        plus.className = "cg-folder-plus";
        plus.textContent = "+";
        add.appendChild(plus);
        grid.appendChild(add);
        for (const row of items) {
            const wrap = doc.createElement("div"), folder = tile(row.name, false);
            wrap.className = "cg-folder-entry";
            folder.title = row.name + " (" + row.count + ")";
            const cover = gallery.preview(row.coverUrl);
            if (cover) {
                const image = doc.createElement("img");
                image.alt = "";
                image.loading = "lazy";
                image.decoding = "async";
                image.dataset.cover = cover;
                image.addEventListener("error", () => { image.hidden = true; gallery.release(image); });
                folder.appendChild(image);
                covers.observe(image);
            }
            const del = button("cg-tile-delete", "×");
            del.title = t("Delete collection") + " · " + row.name;
            del.setAttribute("aria-label", del.title);
            del.addEventListener("click", () => {
                if (doc.defaultView.confirm(t("Delete collection “{name}”? Its items will stay in Favorites.", { name: row.name })))
                    void edit("delete", row.name);
            });
            wrap.append(folder, del);
            grid.appendChild(wrap);
        }
        if (focused) [...grid.querySelectorAll(".cg-folder-tile")].find(el => el.dataset.folder === focused)?.focus({ preventScroll: true });
    }
    function renderMenu() {
        const focused = surface.focusChoice || doc.activeElement?.dataset?.choice;
        delete surface.focusChoice;
        rows.replaceChildren();
        for (const row of items) {
            const line = doc.createElement("div");
            line.className = "cg-membership-row";
            const choice = button("cg-collection-choice", row.name);
            choice.dataset.choice = row.name;
            choice.setAttribute("aria-pressed", String(row.contains));
            choice.title = row.name;
            choice.addEventListener("click", () => { void edit("membership", row.name, !row.contains); });
            line.appendChild(choice);
            if (row.contains && surface.canCover) {
                const cover = button("cg-cover-choice", t("Cover"));
                cover.dataset.current = String(row.isCover);
                cover.title = t(row.isCover ? "Current cover" : "Use as cover") + " · " + row.name;
                cover.setAttribute("aria-label", cover.title);
                cover.addEventListener("click", () => { void edit("cover", row.name); });
                line.appendChild(cover);
            }
            rows.appendChild(line);
        }
        if (ready && !items.length) message().textContent = t("No collections yet.");
        if (focused) [...rows.querySelectorAll(".cg-collection-choice")].find(el => el.dataset.choice === focused)?.focus({ preventScroll: true });
        position();
    }
    async function load() {
        if (!surface) return;
        reading?.abort();
        const controller = reading = new AbortController();
        ready = false;
        controls();
        const params = new URLSearchParams({ nsfw: gallery.rating() });
        if (inMenu()) params.set("favoriteId", String(surface.item.id));
        try {
            const data = await request("/civitai_gallery/collections?" + params, { signal: controller.signal });
            if (controller !== reading) return;
            if (!Array.isArray(data?.items)) throw new Error(t("Cannot read collections."));
            items = data.items;
            favorite = data.favorite;
            ready = true;
            message().textContent = "";
            if (inMenu()) renderMenu(); else renderFolders();
            controls();
        } catch (error) {
            if (controller !== reading) return;
            message().textContent = error.message + " ";
            const retry = button("cg-btn", t("Retry"));
            retry.addEventListener("click", load, { once: true });
            message().appendChild(retry);
        } finally { if (controller === reading) reading = null; }
    }
    async function edit(action, name, member) {
        if (!ready || writing || !surface) return;
        const origin = surface;
        const data = { action, name };
        if (origin.item) {
            if (menu.contains(doc.activeElement)) origin.focusChoice = name;
            data.favoriteId = String(origin.item.id);
            if (action === "membership") data.member = member;
            if (!favorite && (action === "create" || member)) {
                data.item = origin.item;
                if (origin.tagId) data.tag_id = origin.tagId;
            }
        }
        writing = true;
        controls();
        try {
            const result = await request("/civitai_gallery/collections", { method: "POST",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
            if (surface === origin && action === "create") closeForm();
            if (result.favoriteAdded) changes.dispatchEvent(new CustomEvent("change", { detail: { key: data.favoriteId, active: true } }));
            changes.dispatchEvent(new CustomEvent("collections", { detail: { action, name, member, favoriteId: data.favoriteId } }));
        } catch (error) {
            if (surface === origin) { message().textContent = error.message; }
        } finally { writing = false; if (surface) controls(); }
    }
    function openMenu(anchor, item, canCover, tagId) {
        if (surface?.button === anchor) { close(true); return; }
        close();
        gallery.onOpen();
        surface = { button: anchor, item, canCover, tagId };
        menu.hidden = false;
        anchor.setAttribute("aria-expanded", "true");
        message().textContent = t("Loading…");
        position();
        doc.addEventListener("pointerdown", outside, true);
        menu.focus({ preventScroll: true });
        void load();
    }
    function openExplorer(event) {
        const opener = event.currentTarget;
        if (surface && !inMenu()) { close(true); return; }
        close();
        gallery.onOpen();
        surface = { button: opener };
        panel.hidden = false;
        scroll.inert = true;
        root.classList.add("cg-exploring");
        opener.setAttribute("aria-expanded", "true");
        updatePath();
        find("explorer-close").focus({ preventScroll: true });
        message().textContent = t("Loading…");
        void load();
    }
    toggle.addEventListener("click", openExplorer);
    entry.addEventListener("click", openExplorer);
    menuNew.addEventListener("click", showForm);
    find("all-favorites").addEventListener("click", () => openFolder(""));
    find("explorer-close").addEventListener("click", () => close(true));
    for (const pane of [menu, panel, path]) pane.addEventListener("keydown", event => {
        if (!surface) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        } else if (inMenu() && !form && ["ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const choices = [...rows.querySelectorAll(".cg-collection-choice"), menuNew];
            const index = choices.indexOf(doc.activeElement);
            choices[(index + (event.key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length].focus();
        }
    });
    changes.addEventListener("collections", load);
    changes.addEventListener("change", load);
    return {
        close, position, load, updatePath,
        get exploring() { return Boolean(surface && !inMenu()); },
        addButton(item, canCover, tagId) {
            const el = button("cg-collect", t("Add to a collection"));
            el.setAttribute("aria-controls", menu.id);
            el.setAttribute("aria-haspopup", "dialog");
            el.setAttribute("aria-expanded", "false");
            el.addEventListener("click", event => { event.stopPropagation(); openMenu(el, item, canCover, tagId); });
            return el;
        },
        unmount(card) { if (inMenu() && card.contains(surface.button)) close(); },
        onScroll() {
            if (!inMenu()) return;
            const anchor = surface.button.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
            if (anchor.bottom <= viewport.top || anchor.top >= viewport.bottom) close();
            else position();
        },
        dispose() { close(); changes.removeEventListener("collections", load); changes.removeEventListener("change", load); },
    };
}
