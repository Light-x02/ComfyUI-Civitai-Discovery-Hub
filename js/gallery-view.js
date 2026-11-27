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

export function createHubWidgetRoot(doc) {
    if (!doc.getElementById("civitai-discovery-hub-stylesheet")) {
        const link = doc.createElement("link");
        link.id = "civitai-discovery-hub-stylesheet";
        link.rel = "stylesheet";
        link.href = new URL("./gallery.css", import.meta.url).href;
        doc.head.appendChild(link);
    }

    const root = doc.createElement("div");
    root.classList.add("civitai-hub-ui");
    return root;
}

export function buildGalleryView(doc) {
    const uid = `cg-${Math.random().toString(36).slice(2, 9)}`;
    const root = createHubWidgetRoot(doc);
    root.id = uid;
    root.classList.add("civitai-discovery-gallery");
    root.innerHTML = `
<div class="cg-root">
  <header class="cg-header">
    <div class="cg-bar">
      <div class="cg-brand"><span class="cg-mark" aria-hidden="true"><i></i><i></i><i></i></span>Civitai Discovery Hub</div>
      <div class="cg-tabs" role="tablist" aria-label="Gallery controls">
        <button type="button" role="tab" id="${uid}-tab-filters" aria-controls="${uid}-panel-filters" class="cg-tab cg-tab-filters" aria-selected="true">Filters</button>
        <button type="button" role="tab" id="${uid}-tab-models" aria-controls="${uid}-panel-models" class="cg-tab cg-tab-models" aria-selected="false" tabindex="-1">Model search</button>
        <button type="button" role="tab" id="${uid}-tab-view" aria-controls="${uid}-panel-view" class="cg-tab cg-tab-view" aria-selected="false" tabindex="-1">View</button>
      </div>
      <div class="cg-actions">
        <button type="button" class="cg-btn toggle cg-toggle-favonly" title="Show favorites only"><span aria-hidden="true">&#9734;</span> Favorites</button>
        <button type="button" class="cg-btn cg-refresh" aria-label="Refresh gallery" title="Refresh gallery">&#8635;</button>
        <button type="button" class="cg-btn cg-clear-previews" title="Unload images and videos. Turn Display on to reload this page.">Clear previews</button>
        <button type="button" class="cg-btn cg-toggle-render cg-render-on">Display: ON</button>
      </div>
    </div>
    <section id="${uid}-panel-filters" role="tabpanel" aria-labelledby="${uid}-tab-filters" class="cg-panel cg-panel-filters">
      <div class="cg-field"><label for="${uid}-nsfw">NSFW</label>
      <select id="${uid}-nsfw" class="cg-select cg-nsfw">
        <option>None</option><option>Soft</option><option>Mature</option><option>X</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-sort">Sort</label>
      <select id="${uid}-sort" class="cg-select cg-sort">
        <option>Newest</option><option>Most Reactions</option><option>Most Comments</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-period">Period</label>
      <select id="${uid}-period" class="cg-select cg-period">
        <option>AllTime</option><option>Year</option><option>Month</option><option>Week</option><option>Day</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-tags">Tags</label>
      <select id="${uid}-tags" class="cg-select cg-tags"><option value="">None</option></select></div>
      <div class="cg-field cg-author"><label for="${uid}-user">Creator</label>
        <div class="cg-input-group"><input id="${uid}-user" class="cg-input cg-username" placeholder="Username" autocomplete="off"><button type="button" class="cg-btn cg-search">Apply</button></div>
      </div>
      <div class="cg-switches">
        <button type="button" class="cg-btn toggle cg-toggle-video">Videos only</button>
        <button type="button" class="cg-btn toggle cg-toggle-noprompt" title="Hide items without a positive prompt">With prompt</button>
      </div>
    </section>
    <section id="${uid}-panel-models" role="tabpanel" aria-labelledby="${uid}-tab-models" class="cg-panel cg-panel-models" hidden>
      <div class="cg-field"><label for="${uid}-query">Checkpoint or LoRA</label>
        <div class="cg-input-group"><input id="${uid}-query" class="cg-input cg-model-query" placeholder="Search by name" autocomplete="off"><button type="button" class="cg-btn cg-clear-model" aria-label="Clear model search" title="Clear model search">&times;</button><button type="button" class="cg-btn cg-find-model">Find model</button></div>
      </div>
      <div class="cg-field"><label for="${uid}-model">Model filter</label><select id="${uid}-model" class="cg-select cg-model"></select></div>
      <span class="cg-model-hint" hidden>Turn off Favorites to search the online gallery by model.</span>
      <span class="cg-model-status" role="status"></span>
    </section>
    <section id="${uid}-panel-view" role="tabpanel" aria-labelledby="${uid}-tab-view" class="cg-panel cg-panel-view" hidden>
      <div class="cg-field"><label for="${uid}-thumb">Thumbnails</label>
      <select id="${uid}-thumb" class="cg-select cg-thumb">
        <option value="160">Small</option><option value="220">Medium</option>
        <option value="280" selected>Standard</option><option value="400">Large</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-resolution">Preview resolution</label>
      <select id="${uid}-resolution" class="cg-select cg-resolution">
        <option value="256">256 px</option><option value="512" selected>512 px</option>
        <option value="768">768 px</option><option value="1024">1024 px</option>
        <option value="original">Original URL</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-limit">Per page</label>
      <select id="${uid}-limit" class="cg-select cg-limit">
        <option value="24" selected>24</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="150">150</option>
      </select></div>
    </section>
  </header>
  <div class="cg-scroll" tabindex="0" role="region" aria-label="Civitai gallery" data-capture-wheel="true">
    <div class="cg-masonry"></div>
  </div>
  <footer class="cg-foot">
    <span class="cg-selection" aria-live="polite"></span>
    <nav class="cg-pager" aria-label="Gallery pages">
      <button type="button" class="cg-btn cg-first">D&#233;but</button>
      <button type="button" class="cg-btn cg-prev">Pr&#233;c&#233;dent</button>
      <span class="cg-numbers"></span>
      <button type="button" class="cg-btn cg-next">Suivant</button>
    </nav>
    <div class="cg-feedback"><span class="cg-status" role="status" aria-live="polite"></span><button type="button" class="cg-btn cg-retry" hidden>Retry</button></div>
    <span class="cg-favorite-status" role="status"></span>
  </footer>
</div>`;

    const tags = root.querySelector(".cg-tags");
    for (const group of USER_TAG_GROUPS) {
        const options = doc.createElement("optgroup");
        options.label = group.label;
        for (const tag of group.items) {
            const option = doc.createElement("option");
            option.textContent = tag.name;
            option.value = tag.id;
            options.appendChild(option);
        }
        tags.appendChild(options);
    }
    return root;
}
