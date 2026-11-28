import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { galleryLabels, hubLanguage, loadHubLanguage } from "../js/hub-i18n.js";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const languages = ["fr", "es", "zh", "zh-TW", "ja", "ko"];

test("all six dictionaries cover the same controls and preserve every named placeholder", () => {
    const keys = Object.keys(read("../js/locales/fr.json")).sort();
    const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();
    for (const language of languages) {
        const labels = read("../js/locales/" + language + ".json");
        assert.deepEqual(Object.keys(labels).sort(), keys, language);
        for (const key of keys) {
            assert.ok(labels[key].trim(), language + ": " + key);
            assert.deepEqual(placeholders(labels[key]), placeholders(key), language + ": " + key);
        }
        const defs = read("../locales/" + language + "/nodeDefs.json");
        const hub = defs.CivitaiDiscoveryHubNode, cleaner = defs.ClearLoraName;
        assert.equal(cleaner.display_name, "🧹 " + labels["Clear LoRA Name"]);
        assert.deepEqual(Object.keys(hub.outputs), ["0", "1", "2", "3"]);
        for (const [index, kind] of ["positive", "negative"].entries()) {
            const input = cleaner.inputs[kind + "_prompt"];
            assert.ok(input.tooltip && input.name);
            assert.equal(input.name, hub.outputs[index].name);
            assert.equal(input.name, cleaner.outputs[index].name);
        }
    }
});

test("ComfyUI takes precedence over the browser and explicit Chinese scripts take precedence over regions", () => {
    const doc = { documentElement: { lang: "es" }, defaultView: { navigator: { language: "ko" } } };
    for (const [setting, expected] of [
        ["zh", "zh"], ["zh-CN", "zh"], ["zh-SG", "zh"], ["zh_TW", "zh-TW"], ["zh-HK", "zh-TW"],
        ["zh-MO", "zh-TW"], ["zh-Hans-TW", "zh"], ["zh-Hant-CN", "zh-TW"],
        ["fr-CA", "fr"], ["es-419", "es"], ["ja-JP", "ja"], ["ko-KR", "ko"], ["en-GB", "en"], ["de", "en"],
    ]) {
        const app = { extensionManager: { setting: { get: key => key === "Comfy.Locale" && setting } } };
        assert.equal(hubLanguage(app, doc), expected, setting);
    }
    assert.equal(hubLanguage({ ui: { settings: { getSettingValue: () => "ja" } } }, doc), "ja");
    assert.equal(hubLanguage({}, doc), "es");
    doc.documentElement.lang = "";
    assert.equal(hubLanguage({}, doc), "ko");
    assert.equal(hubLanguage({}, {}), "en");
});

test("both nodes share one local dictionary request per language, and user-supplied text stays literal", async () => {
    const requests = [];
    const doc = { documentElement: { lang: "en" }, defaultView: { async fetch(url) {
        requests.push(url.pathname.split("/").at(-1));
        return Response.json(JSON.parse(readFileSync(url, "utf8")));
    } } };
    await loadHubLanguage({}, doc);
    assert.deepEqual(requests, []);
    doc.documentElement.lang = "zh-TW";
    await Promise.all([loadHubLanguage({}, doc), loadHubLanguage({}, doc)]);
    await loadHubLanguage({}, doc);
    assert.deepEqual(requests, ["zh-TW.json"]);
    const name = "Favorites {name} $& <花>";
    assert.equal(galleryLabels("zh-TW")("Delete saved search “{name}”?", { name }), "要刪除已儲存的搜尋「" + name + "」嗎？");
});
