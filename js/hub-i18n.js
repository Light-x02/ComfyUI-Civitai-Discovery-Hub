const catalogs = new Map();
const loading = new Map();

export function hubLanguage(app, doc) {
    const locale = app.extensionManager?.setting?.get?.("Comfy.Locale") || app.ui?.settings?.getSettingValue?.("Comfy.Locale")
        || doc.documentElement?.lang || doc.defaultView?.navigator?.language || "en";
    const [base, ...parts] = locale.toLowerCase().replaceAll("_", "-").split("-");
    if (base === "zh") {
        const script = parts.find(part => part === "hans" || part === "hant");
        const traditional = script ? script === "hant" : parts.some(part => ["tw", "hk", "mo"].includes(part));
        return traditional ? "zh-TW" : "zh";
    }
    return ["es", "fr", "ja", "ko"].includes(base) ? base : "en";
}

export function loadHubLanguage(app, doc) {
    const language = hubLanguage(app, doc);
    if (language === "en" || catalogs.has(language)) return;
    if (!loading.has(language)) {
        const url = new URL(`./locales/${language}.json`, import.meta.url);
        const ready = doc.defaultView.fetch(url).then(async response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            catalogs.set(language, await response.json());
        }).catch(error => console.warn(`Civitai Discovery Hub: could not load ${language} translations.`, error))
            .finally(() => loading.delete(language));
        loading.set(language, ready);
    }
    return loading.get(language);
}

export function galleryLabels(language) {
    const labels = catalogs.get(language);
    return (key, values) => {
        const label = labels && Object.hasOwn(labels, key) ? labels[key] : key;
        return values ? label.replace(/\{(\w+)\}/g, (_, name) => values[name]) : label;
    };
}
