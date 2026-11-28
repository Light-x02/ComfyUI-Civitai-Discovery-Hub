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

export function buildGalleryView(doc, t) {
    const uid = `cg-${Math.random().toString(36).slice(2, 9)}`;
    const root = createHubWidgetRoot(doc);
    root.id = uid;
    root.classList.add("civitai-discovery-gallery");
    root.innerHTML = `
<div class="cg-root">
  <header class="cg-header">
    <div class="cg-bar">
      <div class="cg-brand" title="Civitai Discovery Hub"><span class="cg-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="cg-brand-name">Civitai Discovery Hub</span></div>
      <div class="cg-tabs" role="tablist" aria-label="${t("Gallery controls")}">
        <button type="button" role="tab" id="${uid}-tab-filters" aria-controls="${uid}-panel-filters" class="cg-tab cg-tab-filters" aria-selected="true">${t("Filters")}</button>
        <button type="button" role="tab" id="${uid}-tab-models" aria-controls="${uid}-panel-models" class="cg-tab cg-tab-models" aria-selected="false" tabindex="-1">${t("Model search")}</button>
        <button type="button" role="tab" id="${uid}-tab-link" aria-controls="${uid}-panel-link" class="cg-tab cg-tab-link" aria-selected="false" tabindex="-1">${t("Open link")}</button>
        <button type="button" role="tab" id="${uid}-tab-view" aria-controls="${uid}-panel-view" class="cg-tab cg-tab-view" aria-selected="false" tabindex="-1">${t("View")}</button>
        <button type="button" role="tab" id="${uid}-tab-storage" aria-controls="${uid}-panel-storage" class="cg-tab cg-tab-storage" aria-selected="false" tabindex="-1">${t("Storage")}</button>
      </div>
      <div class="cg-actions">
        <button type="button" class="cg-btn toggle cg-toggle-favonly" title="${t("Show favorites only")}"><span aria-hidden="true">&#9734;</span> ${t("Favorites")}</button>
        <button type="button" class="cg-btn cg-refresh" aria-label="${t("Refresh gallery")}" title="${t("Refresh gallery")}">&#8635;</button>
        <button type="button" class="cg-btn cg-toggle-render cg-render-on">${t("Display: ON")}</button>
        <a class="cg-btn cg-support" href="https://ko-fi.com/light_x02" target="_blank" rel="noopener noreferrer"
           aria-label="${t("Donate to Light_x02 on Ko-fi (opens in a new tab)")}" title="${t("Donate to Light_x02 on Ko-fi (opens in a new tab)")}">
          <span aria-hidden="true">&#9749;&#65038;</span><span class="cg-support-label">${t("Donate")}</span>
        </a>
      </div>
    </div>
    <section id="${uid}-panel-filters" role="tabpanel" aria-labelledby="${uid}-tab-filters" class="cg-panel cg-panel-filters">
      <div class="cg-field cg-rating"><label for="${uid}-nsfw">NSFW</label>
      <select id="${uid}-nsfw" class="cg-select cg-nsfw">
        <option value="None">${t("None")}</option><option value="Soft">${t("Soft")}</option><option value="Mature">${t("Mature")}</option><option value="X">X</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-sort">${t("Sort")}</label>
      <select id="${uid}-sort" class="cg-select cg-sort">
        <option value="Newest">${t("Newest")}</option><option value="Oldest">${t("Oldest")}</option><option value="Most Reactions">${t("Most Reactions")}</option><option value="Most Comments">${t("Most Comments")}</option><option class="cg-collected" value="Most Collected">${t("Most Collected")}</option><option value="Random">${t("Random")}</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-period">${t("Period")}</label>
      <select id="${uid}-period" class="cg-select cg-period">
        <option value="AllTime">${t("All time")}</option><option value="Year">${t("Year")}</option><option value="Month">${t("Month")}</option><option value="Week">${t("Week")}</option><option value="Day">${t("Day")}</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-tags">${t("Tags")}</label>
      <select id="${uid}-tags" class="cg-select cg-tags" title="${t("Match all selected tags")}"><option value="">${t("Add a tag…")}</option></select></div>
      <div class="cg-field cg-author"><label for="${uid}-user">${t("Creator")}</label>
        <div class="cg-input-group"><input id="${uid}-user" class="cg-input cg-username" list="${uid}-creators" placeholder="${t("Username")}" autocomplete="off" spellcheck="false"><datalist id="${uid}-creators" class="cg-creators"></datalist><button type="button" class="cg-btn cg-search">${t("Apply")}</button></div>
      </div>
      <div class="cg-switches">
        <button type="button" class="cg-btn toggle cg-toggle-video">${t("Videos only")}</button>
        <button type="button" class="cg-btn toggle cg-toggle-noprompt" title="${t("Hide items without a positive prompt")}">${t("With prompt")}</button>
      </div>
      <div class="cg-tag-chips" role="group" aria-label="${t("Selected tags")}"></div>
    </section>
    <section id="${uid}-panel-models" role="tabpanel" aria-labelledby="${uid}-tab-models" class="cg-panel cg-panel-models" hidden>
      <div class="cg-field"><label for="${uid}-model-type">${t("Model type")}</label>
        <select id="${uid}-model-type" class="cg-select cg-model-type"></select>
      </div>
      <div class="cg-field"><label for="${uid}-base">${t("Base model")}</label><select id="${uid}-base" class="cg-select cg-base"></select></div>
      <div class="cg-field"><label for="${uid}-query">${t("Model name")}</label>
        <div class="cg-input-group"><input id="${uid}-query" class="cg-input cg-model-query" placeholder="${t("Search by name")}" autocomplete="off" aria-describedby="${uid}-model-status"><button type="button" class="cg-btn cg-clear-model" aria-label="${t("Clear model search")}" title="${t("Clear model search")}">&times;</button><button type="button" class="cg-btn cg-find-model">${t("Find model")}</button></div>
        <span id="${uid}-model-status" class="cg-model-status" role="status"></span>
      </div>
      <div class="cg-field cg-model-field"><label for="${uid}-model">${t("Model filter")}</label>
        <select id="${uid}-model" class="cg-select cg-model" aria-describedby="${uid}-model-feedback"></select>
        <span id="${uid}-model-feedback" class="cg-model-feedback"><span class="cg-model-count" role="status"></span><span class="cg-model-criteria"></span></span>
      </div>
      <div class="cg-field"><label for="${uid}-version">${t("Version")}</label><select id="${uid}-version" class="cg-select cg-version"></select></div>
      <span class="cg-model-hint" hidden></span>
      <span class="cg-catalog-status" role="status"></span>
    </section>
    <section id="${uid}-panel-link" role="tabpanel" aria-labelledby="${uid}-tab-link" class="cg-panel cg-panel-link" hidden>
      <div class="cg-field"><label for="${uid}-link">${t("Civitai image or post URL")}</label>
        <div class="cg-input-group"><input id="${uid}-link" class="cg-input cg-link-input" type="url" placeholder="https://civitai.com/images/…" autocomplete="off" spellcheck="false"><button type="button" class="cg-btn cg-open-link">${t("Open")}</button></div>
      </div>
      <span class="cg-link-status" role="status"></span>
    </section>
    <section id="${uid}-panel-view" role="tabpanel" aria-labelledby="${uid}-tab-view" class="cg-panel cg-panel-view" hidden>
      <div class="cg-field"><label for="${uid}-thumb">${t("Thumbnails")}</label>
      <select id="${uid}-thumb" class="cg-select cg-thumb">
        <option value="160">${t("Small")}</option><option value="220">${t("Medium")}</option>
        <option value="280" selected>${t("Standard")}</option><option value="400">${t("Large")}</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-resolution">${t("Preview resolution")}</label>
      <select id="${uid}-resolution" class="cg-select cg-resolution">
        <option value="256">256 px</option><option value="512" selected>512 px</option>
        <option value="768">768 px</option><option value="1024">1024 px</option>
        <option value="original">${t("Original URL")}</option>
      </select></div>
      <div class="cg-field"><label for="${uid}-limit">${t("Per page")}</label>
      <select id="${uid}-limit" class="cg-select cg-limit">
        <option value="24" selected>24</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="150">150</option>
      </select></div>
    </section>
    <section id="${uid}-panel-storage" role="tabpanel" aria-labelledby="${uid}-tab-storage" class="cg-panel cg-panel-storage" hidden>
      <div class="cg-field"><label for="${uid}-folder">${t("Favorites folder")}</label>
        <div class="cg-input-group"><input id="${uid}-folder" class="cg-input cg-folder" type="text" autocomplete="off" spellcheck="false" disabled>
          <button type="button" class="cg-btn cg-folder-browse" aria-expanded="false" aria-controls="${uid}-folders" disabled>${t("Browse")}</button>
          <button type="button" class="cg-btn cg-folder-default" disabled>${t("Use default")}</button>
          <button type="button" class="cg-btn cg-folder-save" disabled>${t("Save folder")}</button></div>
        <select id="${uid}-folders" class="cg-select cg-folder-list" aria-label="${t("Browse folders on the ComfyUI computer")}" hidden></select>
      </div>
      <span class="cg-folder-status" role="status"></span>
      <div class="cg-cache-row"><button type="button" class="cg-btn cg-clear-cache"></button><span class="cg-cache-status" role="status"></span></div>
    </section>
  </header>
  <div class="cg-context">
    <details class="cg-applied">
      <summary class="cg-applied-toggle"><span class="cg-applied-label">${t("Gallery filters")}</span><span class="cg-applied-brief"></span></summary>
      <dl class="cg-applied-list" aria-label="${t("Current gallery settings")}" tabindex="0"></dl>
    </details>
    <button type="button" class="cg-btn cg-saved-toggle" aria-expanded="false" aria-controls="${uid}-library">${t("Saved searches")}</button>
    <div class="cg-link-source" hidden><span class="cg-link-label"></span><button type="button" class="cg-btn cg-back-gallery">${t("Back to gallery")}</button></div>
  </div>
  <nav class="cg-collection-path" aria-label="${t("Collections")}" hidden>
    <button type="button" class="cg-btn cg-all-favorites"></button><span aria-hidden="true">›</span>
    <span class="cg-collection-parent"><button type="button" class="cg-btn cg-collections-toggle" aria-expanded="false" aria-controls="${uid}-collections">${t("Collections")}</button><span aria-hidden="true">›</span></span>
    <strong class="cg-current-collection" aria-current="page"></strong>
    <button type="button" class="cg-btn cg-explorer-close">&#215;</button>
  </nav>
  <div class="cg-body">
    <div class="cg-scroll" tabindex="0" role="region" aria-label="${t("Civitai gallery")}" data-capture-wheel="true">
      <div class="cg-masonry">
        <button type="button" class="cg-collections-entry" aria-expanded="false" aria-controls="${uid}-collections" hidden><span class="cg-collections-label">${t("Collections")}</span></button>
      </div>
    </div>
    <section class="cg-resources" id="${uid}-resources" aria-label="${t("Resources used by the selected image or video")}" hidden>
      <ul class="cg-resource-list"></ul>
    </section>
    <section class="cg-inspector" id="${uid}-details" tabindex="-1" aria-labelledby="${uid}-detail-title" hidden>
      <div class="cg-detail-bar">
        <strong class="cg-detail-title" id="${uid}-detail-title"></strong>
        <span class="cg-detail-position"></span>
        <button type="button" class="cg-btn cg-detail-prev" aria-label="${t("Previous item")}" title="${t("Previous item (left arrow)")}">&#8592;</button>
        <button type="button" class="cg-btn cg-detail-next" aria-label="${t("Next item")}" title="${t("Next item (right arrow)")}">&#8594;</button>
        <button type="button" class="cg-btn cg-detail-close" aria-label="${t("Close details")}" title="${t("Close details (Esc)")}">&#215;</button>
      </div>
      <div class="cg-detail-content">
        <div class="cg-detail-stage"><div class="cg-detail-media"></div><button type="button" class="cg-btn cg-detail-enlarge" aria-pressed="false">${t("Enlarge")}</button></div>
        <div class="cg-detail-notes" tabindex="0" aria-label="${t("Prompts and generation parameters")}">
          <div class="cg-detail-heading"><strong>${t("Positive prompt")}</strong><button type="button" class="cg-btn cg-copy-positive" aria-label="${t("Copy positive prompt")}">${t("Copy")}</button></div>
          <p class="cg-prompt cg-positive-text"></p>
          <div class="cg-detail-heading"><strong>${t("Negative prompt")}</strong><button type="button" class="cg-btn cg-copy-negative" aria-label="${t("Copy negative prompt")}">${t("Copy")}</button></div>
          <p class="cg-prompt cg-negative-text"></p>
          <strong>${t("Generation parameters")}</strong><dl class="cg-parameters"></dl><p class="cg-no-parameters">${t("No parameters published.")}</p>
          <details class="cg-extra-parameters" hidden><summary>${t("More parameters")}</summary><pre class="cg-extra-json"></pre></details>
          <span class="cg-copy-status" role="status"></span>
        </div>
      </div>
    </section>
    <section class="cg-library" id="${uid}-library" aria-labelledby="${uid}-library-title" hidden>
      <div class="cg-library-bar"><strong class="cg-library-title" id="${uid}-library-title">${t("Saved searches")}</strong>
        <button type="button" class="cg-btn cg-library-close" aria-label="${t("Close panel")}">&#215;</button></div>
      <div class="cg-field"><label for="${uid}-library-select">${t("Saved search")}</label>
        <div class="cg-input-group"><select id="${uid}-library-select" class="cg-select cg-library-select"></select>
          <button type="button" class="cg-btn cg-library-apply">${t("Apply")}</button>
          <button type="button" class="cg-btn cg-library-update" title="${t("Replace this search with the current filters")}">${t("Update")}</button>
          <button type="button" class="cg-btn cg-library-delete">${t("Delete")}</button></div>
      </div>
      <div class="cg-field"><label for="${uid}-library-name">${t("Save current filters as")}</label>
        <div class="cg-input-group"><input id="${uid}-library-name" class="cg-input cg-library-name" maxlength="80" placeholder="${t("Search name")}" autocomplete="off">
          <button type="button" class="cg-btn cg-library-create">${t("Save")}</button></div></div>
      <span class="cg-library-status" role="status"></span>
    </section>
    <section class="cg-explorer" id="${uid}-collections" aria-label="${t("Collections")}" hidden>
      <div class="cg-explorer-editor"></div>
      <div class="cg-explorer-scroll" tabindex="0" aria-label="${t("Collections")}">
        <div class="cg-collection-grid"></div>
      </div>
      <p class="cg-explorer-status" role="status"></p>
    </section>
  </div>
  <footer class="cg-foot">
    <div class="cg-selected-item"><span class="cg-selection" aria-live="polite"></span>
      <button type="button" class="cg-btn cg-detail-toggle" aria-controls="${uid}-details" aria-expanded="false" hidden>${t("Details")}</button>
      <button type="button" class="cg-btn cg-resource-toggle" aria-controls="${uid}-resources" aria-expanded="false" hidden>${t("Resources")}</button></div>
    <nav class="cg-pager" aria-label="${t("Gallery pages")}">
      <button type="button" class="cg-btn cg-first">${t("First")}</button>
      <button type="button" class="cg-btn cg-prev">${t("Previous")}</button>
      <span class="cg-numbers"></span>
      <button type="button" class="cg-btn cg-next">${t("Next")}</button>
      <button type="button" class="cg-btn cg-shuffle" title="${t("Draw another selection with the current filters")}" hidden>
        <svg width="22" height="16" viewBox="0 0 24 18" aria-hidden="true" focusable="false">
          <g transform="rotate(-10 12 9)">
            <rect x="2" y="3.5" width="20" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <path d="M12 4v10" stroke="currentColor"/>
            <g fill="currentColor"><circle cx="5.5" cy="6.5" r="1.15"/><circle cx="8.5" cy="11.5" r="1.15"/>
              <circle cx="15" cy="6.5" r="1.15"/><circle cx="17" cy="9" r="1.15"/><circle cx="19" cy="11.5" r="1.15"/></g>
          </g>
        </svg>
        ${t("Shuffle again")}
      </button>
    </nav>
    <div class="cg-feedback"><span class="cg-status" role="status" aria-live="polite"></span><button type="button" class="cg-btn cg-retry" hidden>${t("Retry")}</button></div>
    <span class="cg-favorite-status" role="status"></span>
  </footer>
  <section class="cg-collection-menu" role="dialog" id="${uid}-collection-menu" hidden>
    <div class="cg-memberships"></div>
    <button type="button" class="cg-menu-new"></button>
    <div class="cg-menu-editor"></div>
    <p class="cg-menu-status" role="status"></p>
  </section>
</div>`;

    const tagLabel = name => {
        const separator = name.indexOf(" ") + 1;
        return name.slice(0, separator) + t(name.slice(separator));
    };
    const tags = root.querySelector(".cg-tags");
    for (const group of USER_TAG_GROUPS) {
        const options = doc.createElement("optgroup");
        options.label = tagLabel(group.label);
        for (const tag of group.items) {
            const option = doc.createElement("option");
            option.textContent = tagLabel(tag.name);
            option.value = tag.id;
            options.appendChild(option);
        }
        tags.appendChild(options);
    }
    return root;
}
