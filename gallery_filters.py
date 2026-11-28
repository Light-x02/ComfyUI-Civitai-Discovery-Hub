"""Shared filters for Civitai gallery items and saved favorites."""
from typing import Any, Dict


def clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(str(v))
    except ValueError:
        return default
    return max(lo, min(hi, n))


def truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def item_is_video(it: Dict[str, Any]) -> bool:
    if it.get("type") in ("image", "video"):
        return it["type"] == "video"
    meta = it["meta"] if isinstance(it.get("meta"), dict) else {}
    urls = (it.get("url"), meta.get("video"), meta.get("videoUrl"), meta.get("mp4"), meta.get("mp4Url"))
    return any(isinstance(url, str) and url.split("?", 1)[0].split("#", 1)[0].lower().endswith((".mp4", ".webm", ".mov", ".m4v")) for url in urls)


POSITIVE_PROMPT_KEYS = ("prompt", "Prompt", "positive", "positivePrompt", "textPrompt")


def generation_meta(item):
    meta = item.get("meta") if isinstance(item, dict) else None
    if not isinstance(meta, dict):
        return {}
    # The legacy Civitai response wraps generation parameters in {id, meta}.
    if isinstance(meta.get("meta"), dict) and meta.keys() <= {"id", "meta"}:
        return meta["meta"]
    return meta


def positive_prompt(meta):
    for key in POSITIVE_PROMPT_KEYS:
        text = meta.get(key)
        if isinstance(text, str) and text.strip():
            return text
    return ""


def civitai_tag_ids(item):
    tags = set()
    for field in ("tags", "tagIds", "civitaiTagIds"):
        values = item.get(field)
        if not isinstance(values, list):
            continue
        for tag in values:
            # Historical "tags" strings are personal labels, including numeric ones.
            if field == "tags" and isinstance(tag, str):
                continue
            value = tag.get("id") if isinstance(tag, dict) else tag
            if isinstance(value, (int, str)) and str(value).isdecimal():
                tags.add(str(value))
    return tags


def item_matches_query_local(it: Dict[str, Any], q: str) -> bool:
    if not q:
        return True
    q = q.lower().strip()
    m = generation_meta(it)
    user = it["user"] if isinstance(it.get("user"), dict) else {}
    buf = " | ".join(
        str(x or "")
        for x in [
            it.get("id"),
            it.get("url"),
            positive_prompt(m),
            m.get("negativePrompt"),
            m.get("NegativePrompt"),
            m.get("negative"),
            it.get("username") or user.get("username") or user.get("name"),
            m.get("Model") or m.get("model") or "",
        ]
    ).lower()
    return q in buf
