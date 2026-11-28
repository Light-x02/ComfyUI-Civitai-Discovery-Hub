function createOption(doc, value, label) {
    const element = doc.createElement("option");
    element.value = String(value);
    element.textContent = label;
    return element;
}

export function creatorSuggestions(doc, find, request, online) {
    const input = find("username"), list = find("creators");
    let timer, pending;
    function cancel() {
        clearTimeout(timer);
        pending?.abort();
        pending = null;
        list.replaceChildren();
    }
    input.addEventListener("input", () => {
        cancel();
        const query = input.value.trim();
        if (query.length < 2 || !online()) return;
        timer = setTimeout(async () => {
            const controller = pending = new AbortController();
            try {
                const data = await request("/civitai_gallery/catalog/creators?" + new URLSearchParams({ query }), { signal: controller.signal });
                if (pending === controller) list.replaceChildren(...data.items.map(name => createOption(doc, name, name)));
            } catch {
                // Typing an exact username still works when suggestions are unavailable.
            } finally {
                if (pending === controller) pending = null;
            }
        }, 300);
    });
    input.addEventListener("blur", cancel);
    return cancel;
}

const MODEL_TYPES = { Checkpoint: "Checkpoints", LORA: "LoRAs" };

function modelCount(count, metadata, t) {
    const total = metadata?.totalItems;
    if (Number.isSafeInteger(total) && total > count) {
        return t(total === 1 ? "{shown} of {total} matching model shown" : "{shown} of {total} matching models shown", { shown: count, total });
    }
    if (metadata?.hasMore === false || total === count) return t(count === 1 ? "1 matching model" : "{count} matching models", { count });
    const shown = t(count === 1 ? "1 model shown" : "{count} models shown", { count });
    return metadata?.hasMore ? t("{shown} · more pages available", { shown }) : shown;
}

export function modelFilters(doc, find, request, state, apply, dirty, t) {
    const option = (value, label) => createOption(doc, value, label);
    const typeFilter = find("model-type"), base = find("base"), query = find("model-query");
    const model = find("model"), version = find("version");
    const findButton = find("find-model"), status = find("model-status"), tab = find("tab-models");
    const count = find("model-count"), criteria = find("model-criteria"), catalogStatus = find("catalog-status");
    let modelRequest, versionRequest, baseRequest, results = null, versionList = null, bases = null;
    let searchTimer = null, searchKey = null;
    let online = true;
    const baseError = t("Full base model list unavailable. Focus the field to retry.");
    const versionError = t("Version list unavailable. Focus the field to retry.");
    typeFilter.replaceChildren(option("", t("All types")), ...Object.entries(MODEL_TYPES).map(([type, label]) => option(type, t(label))));

    function cancelSearch() {
        clearTimeout(searchTimer);
        searchTimer = null;
        searchKey = null;
        modelRequest?.abort();
        modelRequest = null;
        status.textContent = "";
        delete status.dataset.state;
    }
    function cancel() {
        cancelSearch();
        versionRequest?.abort();
        versionRequest = null;
        baseRequest?.abort();
        baseRequest = null;
        catalogStatus.textContent = "";
    }
    function selectedLabel() {
        const model = state().model;
        return model?.label?.replace(/\((Checkpoint|LORA) #(\d+)\)$/, (_, type, id) => `(${t(type)} #${id})`) || (model?.id ? "#" + model.id : "");
    }
    function indicator() {
        const labels = [base.value, online && selectedLabel(), online && state().model?.version?.label].filter(Boolean);
        tab.classList.toggle("cg-has-model", labels.length > 0);
        tab.title = labels.join(" · ") || t("Filter by base model, checkpoint or LoRA");
    }
    function showBases(value) {
        // Keep common choices and saved workflows usable while the live catalog loads.
        const choices = new Set(bases || ["SD 1.5", "SDXL 1.0", "Flux.1 D", "Illustrious", "Pony", "ZImageTurbo"]);
        if (value) choices.add(value);
        base.replaceChildren(option("", t("All base models")), ...Array.from(choices, name => option(name, name)));
        base.value = value;
        indicator();
    }
    async function loadBases() {
        if (bases || baseRequest) return;
        const controller = baseRequest = new AbortController();
        try {
            const data = await request("/civitai_gallery/catalog/bases", { signal: controller.signal });
            if (baseRequest !== controller) return;
            bases = data.items;
            showBases(base.value);
            if (catalogStatus.textContent === baseError) catalogStatus.textContent = "";
        } catch {
            if (baseRequest === controller) catalogStatus.textContent = baseError;
        } finally {
            if (baseRequest === controller) baseRequest = null;
        }
    }

    function showVersions() {
        const selected = state().model?.version;
        const options = (versionList || []).filter(v => !base.value || !v.baseModel || v.baseModel === base.value)
            .map(v => option(v.id, v.name));
        if (selected && !options.some(o => o.value === selected.id)) options.unshift(option(selected.id, selected.label));
        version.replaceChildren(option("", t("All versions")), ...options);
        version.value = selected?.id || "";
        version.disabled = !online || !state().model?.id;
        indicator();
    }
    async function loadVersions() {
        const id = state().model?.id;
        if (!id || !online || versionList || versionRequest) return;
        const controller = versionRequest = new AbortController();
        try {
            const data = await request("/civitai_gallery/catalog/versions?" + new URLSearchParams({ id }), { signal: controller.signal });
            if (versionRequest !== controller || state().model?.id !== id) return;
            versionList = data.items;
            showVersions();
            if (catalogStatus.textContent === versionError) catalogStatus.textContent = "";
        } catch {
            if (versionRequest === controller) catalogStatus.textContent = versionError;
        } finally {
            if (versionRequest === controller) versionRequest = null;
        }
    }
    function showModels() {
        const selected = state().model;
        const selectedId = String(selected?.id ?? "");
        const items = results?.items || [];
        model.replaceChildren(option("", t("All models")));
        if (selectedId && !items.some(item => String(item.id) === selectedId)) model.appendChild(option(selectedId, selectedLabel()));
        for (const [type, label] of Object.entries(MODEL_TYPES)) {
            const options = items.filter(item => item.type === type)
                .map(item => option(item.id, item.name + " (" + t(item.type) + " #" + item.id + ")"));
            if (!options.length) continue;
            if (typeFilter.value) {
                model.append(...options);
            } else {
                const group = doc.createElement("optgroup");
                group.label = t(label);
                group.append(...options);
                model.appendChild(group);
            }
        }
        model.value = selectedId;
        count.textContent = results ? modelCount(items.length, results.metadata, t) : "";
        criteria.textContent = results?.criteria || "";
        criteria.title = criteria.textContent;
        indicator();
    }
    async function search() {
        clearTimeout(searchTimer);
        searchTimer = null;
        const text = query.value.trim();
        const params = new URLSearchParams();
        if (text) params.set("query", text);
        if (typeFilter.value) params.set("modelType", typeFilter.value);
        if (base.value) params.set("baseModels", base.value);
        const key = params.toString();
        if (online && key === searchKey) return;
        cancelSearch();
        results = null;
        showModels();
        if (!online || !key) return;
        const controller = modelRequest = new AbortController();
        searchKey = key;
        status.textContent = t("Searching…");
        try {
            const data = await request("/civitai_gallery/models?" + key, { signal: controller.signal });
            if (modelRequest !== controller) return;
            const items = data.items.filter(item => !typeFilter.value || item.type === typeFilter.value);
            const scope = [typeFilter.value && t(MODEL_TYPES[typeFilter.value]), base.value, text && `“${text}”`].filter(Boolean).join(" · ");
            const metadata = items.length === data.items.length ? data.metadata : { hasMore: data.metadata?.hasMore };
            results = { items, metadata, criteria: scope };
            showModels();
            status.textContent = text ? t("Model filter updated.") : "";
            if (text) status.dataset.state = "updated";
        } catch (error) {
            if (modelRequest === controller) {
                searchKey = null;
                status.dataset.state = "error";
                status.textContent = error.message;
            }
        } finally {
            if (modelRequest === controller) modelRequest = null;
        }
    }
    function loadIfNeeded() {
        if (online && (typeFilter.value || base.value || query.value.trim()) && results === null && !modelRequest && searchTimer === null) void search();
    }
    function setModel(selected, versions = null) {
        versionRequest?.abort();
        versionRequest = null;
        state().model = selected;
        versionList = versions;
        if (catalogStatus.textContent === versionError) catalogStatus.textContent = "";
        showVersions();
    }
    typeFilter.addEventListener("change", () => {
        const cg = state();
        cg.model_search_type = typeFilter.value;
        // Earlier workflows kept the type in the option label only.
        const selected = cg.model;
        const selectedType = selected?.type || /\((Checkpoint|LORA) #\d+\)$/.exec(selected?.label)?.[1];
        if (selected && typeFilter.value && selectedType !== typeFilter.value) {
            setModel(null);
            apply();
        } else dirty();
        void search();
    });
    model.addEventListener("change", () => {
        const item = results?.items.find(item => String(item.id) === model.value);
        if (item) setModel({ id: model.value, label: `${item.name} (${item.type} #${item.id})`, type: item.type }, item.versions);
        else if (!model.value) setModel(null);
        apply();
    });
    version.addEventListener("change", () => {
        const selected = state().model;
        if (!selected) return;
        const model = { ...selected };
        if (version.value) model.version = { id: version.value, label: version.selectedOptions[0].textContent };
        else delete model.version;
        state().model = model;
        indicator();
        apply();
    });
    for (const event of ["focus", "pointerenter"]) {
        version.addEventListener(event, loadVersions);
        base.addEventListener(event, loadBases);
        model.addEventListener(event, loadIfNeeded);
    }
    base.addEventListener("change", () => {
        if (base.value && state().model) setModel(null);
        else showVersions();
        void search();
    });
    findButton.addEventListener("click", search);
    function scheduleSearch(event) {
        cancelSearch();
        results = null;
        showModels();
        if (event.isComposing || !online || !(query.value.trim() || typeFilter.value || base.value)) return;
        status.textContent = t("Searching…");
        searchTimer = setTimeout(search, 350);
    }
    query.addEventListener("input", scheduleSearch);
    query.addEventListener("compositionend", scheduleSearch);
    query.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); search(); }
    });
    find("clear-model").addEventListener("click", () => {
        const hadName = Boolean(query.value.trim());
        cancelSearch();
        if (hadName) results = null;
        query.value = "";
        if (state().model) {
            setModel(null);
            apply();
        }
        showModels();
        if (hadName) loadIfNeeded();
    });

    return {
        cancel,
        loadIfNeeded,
        selectedLabel,
        restore(baseModel) {
            cancel();
            results = null;
            versionList = null;
            query.value = "";
            typeFilter.value = Object.hasOwn(MODEL_TYPES, state().model_search_type) ? state().model_search_type : "";
            showBases(baseModel);
            showModels();
            showVersions();
        },
        setOnline(value, needsVersion) {
            online = value;
            if (!online) cancelSearch();
            find("model-feedback").hidden = status.hidden = !online;
            typeFilter.disabled = model.disabled = query.disabled = findButton.disabled = find("clear-model").disabled = !online;
            version.disabled = !online || !state().model?.id;
            const help = needsVersion ? t("Choose a version for this ranking. Civitai sorts all versions of a model by newest.") : "";
            find("sort").title = help;
            const hint = find("model-hint");
            hint.hidden = online && !needsVersion;
            hint.textContent = online ? help : t("Turn off Favorites to search the online gallery by model.");
            indicator();
        },
    };
}
