# ----- SECTION: Imports -----
import io
import json
import os
import time
import urllib.request
from typing import Any, Dict, List, Optional

import aiohttp
import numpy as np
import torch
from aiohttp import web
from PIL import Image
from server import PromptServer
from typing_extensions import override

from comfy_api.latest import ComfyExtension, io as comfy_io


# ----- SECTION: Constants -----
NODE_DIR = os.path.dirname(os.path.abspath(__file__))
FAVORITES_FILE = os.path.join(NODE_DIR, "civitai_favorites.json")


# ----- SECTION: Favorites Storage -----
def load_favorites() -> Dict[str, Any]:
    if not os.path.exists(FAVORITES_FILE):
        return {}
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_favorites(data: Dict[str, Any]) -> None:
    try:
        tmp = FAVORITES_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, FAVORITES_FILE)
    except Exception as e:
        print(f"CivitaiDiscoveryHub: Error saving favorites: {e}")


# ----- SECTION: Utils -----
def clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(str(v))
    except Exception:
        return default
    return max(lo, min(hi, n))


def truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def item_is_video(it: Dict[str, Any]) -> bool:
    u = str(it.get("url") or "").lower()
    if u.endswith(".mp4") or u.endswith(".webm"):
        return True
    m = it.get("meta") or {}
    mv = str(m.get("video") or m.get("videoUrl") or m.get("mp4") or m.get("mp4Url") or "").lower()
    return mv.endswith(".mp4") or mv.endswith(".webm")


def item_has_positive_prompt(it: Dict[str, Any]) -> bool:
    m = it.get("meta") or {}
    for k in ("prompt", "Prompt", "positive", "textPrompt"):
        if str(m.get(k) or "").strip():
            return True
    return False


def item_matches_query_local(it: Dict[str, Any], q: str) -> bool:
    if not q:
        return True
    q = q.lower().strip()
    m = it.get("meta") or {}
    buf = " | ".join(
        str(x or "")
        for x in [
            it.get("id"),
            it.get("url"),
            m.get("prompt"),
            m.get("Prompt"),
            m.get("textPrompt"),
            m.get("negativePrompt"),
            m.get("NegativePrompt"),
            (it.get("user") or {}).get("username") or (it.get("user") or {}).get("name") or "",
            m.get("Model") or m.get("model") or "",
        ]
    ).lower()
    return q in buf


def _empty_image_tensor() -> torch.Tensor:
    return torch.zeros(1, 1, 1, 3, dtype=torch.float32)


def _download_image_to_tensor(url: str, timeout_s: int = 30) -> torch.Tensor:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        data = resp.read()
    img = Image.open(io.BytesIO(data))
    if getattr(img, "is_animated", False):
        try:
            img.seek(0)
        except Exception:
            pass
    img = img.convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]


# ----- SECTION: Node (V3) -----
class CivitaiDiscoveryHubNode(comfy_io.ComfyNode):
    @classmethod
    def define_schema(cls) -> comfy_io.Schema:
        return comfy_io.Schema(
            node_id="CivitaiDiscoveryHubNode",
            display_name="🖼️ Civitai Discovery Hub",
            category="💡Lightx02/Civitai",
            inputs=[
                comfy_io.String.Input(
                    "selection_data",
                    default="{}",
                    multiline=True,
                    tooltip="JSON payload set by the UI (selected item + flags).",
                )
            ],
            outputs=[
                comfy_io.String.Output(display_name="positive_prompt"),
                comfy_io.String.Output(display_name="negative_prompt"),
                comfy_io.Image.Output(display_name="image"),
                comfy_io.String.Output(display_name="info"),
            ],
        )

    @classmethod
    def is_changed(cls, selection_data: str, **kwargs):
        return selection_data

    @classmethod
    def execute(cls, selection_data: str):
        try:
            node_selection = json.loads(selection_data or "{}")
        except Exception:
            node_selection = {}

        item_data = node_selection.get("item", {}) if isinstance(node_selection, dict) else {}
        should_download = bool(node_selection.get("download_image", False)) if isinstance(node_selection, dict) else False

        meta = item_data.get("meta", {}) if isinstance(item_data, dict) else {}
        if not isinstance(meta, dict):
            meta = {}

        pos_prompt = meta.get("prompt") or meta.get("Prompt") or meta.get("positive") or meta.get("textPrompt") or ""
        neg_prompt = meta.get("negativePrompt") or meta.get("NegativePrompt") or meta.get("negative") or ""
        pos_prompt = str(pos_prompt or "")
        neg_prompt = str(neg_prompt or "")

        image_url = str(item_data.get("url") or "") if isinstance(item_data, dict) else ""

        info_dict = dict(meta)
        for k in ("prompt", "Prompt", "positive", "textPrompt", "negativePrompt", "NegativePrompt", "negative"):
            info_dict.pop(k, None)

        try:
            info_string = json.dumps(info_dict, indent=4, ensure_ascii=False)
        except Exception:
            info_string = "{}"

        tensor = _empty_image_tensor()

        if should_download and image_url:
            try:
                tensor = _download_image_to_tensor(image_url, timeout_s=30)
            except Exception:
                tensor = _empty_image_tensor()

        return (pos_prompt, neg_prompt, tensor, info_string)


# ----- SECTION: Server Routes -----
prompt_server = PromptServer.instance


@prompt_server.routes.get("/civitai_gallery/get_all_favorites_data")
async def get_all_favorites_data(request):
    favorites = load_favorites()
    return web.json_response(favorites)


@prompt_server.routes.post("/civitai_gallery/toggle_favorite")
async def toggle_favorite(request):
    try:
        data = await request.json()
        item = data.get("item")
        if not isinstance(item, dict) or "id" not in item:
            return web.json_response({"status": "error", "message": "Invalid item data"}, status=400)

        item_id = str(item["id"])
        favorites = load_favorites()

        if item_id in favorites:
            del favorites[item_id]
            status = "removed"
        else:
            if item.get("meta") is None or not isinstance(item.get("meta"), dict):
                item["meta"] = {}
            if "tags" not in item or not isinstance(item.get("tags"), list):
                item["tags"] = []
            item["meta"].pop("prompt_saved", None)
            favorites[item_id] = item
            status = "added"

        save_favorites(favorites)
        return web.json_response({"status": status})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@prompt_server.routes.post("/civitai_gallery/add_or_update_favorite")
async def add_or_update_favorite(request):
    try:
        data = await request.json()
        item = data.get("item")
        if not isinstance(item, dict) or "id" not in item:
            return web.json_response({"status": "error", "message": "Invalid item data"}, status=400)

        item_id = str(item["id"])
        favorites = load_favorites()
        favorites[item_id] = item
        save_favorites(favorites)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@prompt_server.routes.get("/civitai_gallery/get_favorites_images")
async def get_favorites_images(request):
    try:
        page = clamp_int(request.query.get("page", "1"), 1, 1_000_000, 1)
        limit = clamp_int(request.query.get("limit", "50"), 1, 200, 50)

        favorites = load_favorites()
        items = list(favorites.values())

        total_items = len(items)
        start_index = (page - 1) * limit
        end_index = start_index + limit
        paginated_items = items[start_index:end_index]

        return web.json_response(
            {
                "items": paginated_items,
                "metadata": {
                    "totalItems": total_items,
                    "currentPage": page,
                    "pageSize": limit,
                    "totalPages": (total_items + limit - 1) // limit,
                },
            }
        )
    except Exception as e:
        print(f"CivitaiDiscoveryHub: get_favorites_images error: {e}")
        return web.json_response({"error": str(e)}, status=500)


@prompt_server.routes.post("/civitai_gallery/update_favorite_tags")
async def update_favorite_tags(request):
    try:
        data = await request.json()
        item_id = str(data.get("id") or "")
        tags = data.get("tags", [])
        if not item_id:
            return web.json_response({"status": "error", "message": "Missing item id"}, status=400)
        if not isinstance(tags, list):
            tags = []

        favorites = load_favorites()
        if item_id in favorites:
            favorites[item_id]["tags"] = tags
            save_favorites(favorites)
            return web.json_response({"status": "success"})
        return web.json_response({"status": "error", "message": "Item not in favorites"}, status=404)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@prompt_server.routes.get("/civitai_gallery/get_all_favorite_tags")
async def get_all_favorite_tags(request):
    try:
        favorites = load_favorites()
        all_tags = set()
        for item in favorites.values():
            tags = item.get("tags")
            if isinstance(tags, list):
                for t in tags:
                    if isinstance(t, str) and t.strip():
                        all_tags.add(t.strip())
        sorted_tags = sorted(list(all_tags), key=lambda s: s.lower())
        return web.json_response({"tags": sorted_tags})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@prompt_server.routes.get("/civitai_gallery/images_stream")
async def get_civitai_images_stream(request):
    try:
        nsfw = (request.query.get("nsfw", "None") or "").strip()
        sort = (request.query.get("sort", "Most Reactions") or "").strip()
        period = (request.query.get("period", "Day") or "").strip()
        username = (request.query.get("username", "") or "").strip()
        tags_q = (request.query.get("tags", "") or "").strip()
        query_q = (request.query.get("query", "") or "").strip()

        include_videos = truthy(request.query.get("include_videos", "false"))
        hide_no_prompt = truthy(request.query.get("hide_no_prompt", "false"))
        videos_only = truthy(request.query.get("videos_only", "false"))

        cursor = request.query.get("cursor", None)
        min_batch = clamp_int(request.query.get("min_batch", "50"), 1, 500, 50)

        time_budget_ms = clamp_int(request.query.get("time_budget_ms", "0"), 0, 15000, 0)
        deadline = (time.monotonic() + (time_budget_ms / 1000.0)) if time_budget_ms > 0 else None

        international_version = truthy(request.query.get("international_version", "true"))
        base_domain = "civitai.com" if international_version else "civitai.work"
        base_url = f"https://{base_domain}/api/v1/images"

        model_id = (request.query.get("modelId", "") or "").strip() or None
        model_ver_id = (request.query.get("modelVersionId", "") or "").strip() or None

        upstream_limit = 200 if videos_only else 100

        def build_params(cur: Optional[str]) -> Dict[str, str]:
            p: Dict[str, str] = {
                "limit": str(upstream_limit),
                "nsfw": nsfw,
                "sort": sort,
                "period": period,
            }
            if username:
                p["username"] = username
            if tags_q:
                p["tags"] = tags_q
            if query_q:
                p["query"] = query_q
            if model_id:
                p["modelId"] = model_id
            if model_ver_id:
                p["modelVersionId"] = model_ver_id
            if cur:
                p["cursor"] = cur
            return p

        async def fetch_once(session: aiohttp.ClientSession, cur: Optional[str]) -> Dict[str, Any]:
            params = build_params(cur)
            async with session.get(base_url, params=params) as resp:
                text = await resp.text()
                if resp.status != 200:
                    return {"items": [], "metadata": {"error": f"upstream {resp.status}", "detail": text[:400]}, "next": None}
                try:
                    data = json.loads(text)
                except Exception:
                    return {"items": [], "metadata": {"error": "bad json"}, "next": None}

                md = data.get("metadata", {}) if isinstance(data, dict) else {}
                nxt = md.get("nextCursor") or md.get("cursor") or md.get("next") or None
                items = data.get("items", []) if isinstance(data, dict) else []
                if not isinstance(items, list):
                    items = []
                return {"items": items, "metadata": md, "next": nxt}

        started = time.monotonic()
        kept: List[Dict[str, Any]] = []
        dropped = 0
        next_cursor = None

        async with aiohttp.ClientSession() as session:
            cur = cursor
            for _ in range(50):
                res = await fetch_once(session, cur)
                rec_items = res.get("items", [])
                next_cursor = res.get("next", None)

                for it in rec_items:
                    if not isinstance(it, dict):
                        dropped += 1
                        continue

                    if videos_only:
                        if not item_is_video(it):
                            dropped += 1
                            continue
                    else:
                        if not include_videos and item_is_video(it):
                            dropped += 1
                            continue

                    if hide_no_prompt and not item_has_positive_prompt(it):
                        dropped += 1
                        continue
                    if query_q and not item_matches_query_local(it, query_q):
                        dropped += 1
                        continue

                    kept.append(it)

                if len(kept) >= min_batch:
                    break

                if deadline is not None and time.monotonic() >= deadline and len(kept) > 0:
                    break

                if not next_cursor:
                    break

                cur = next_cursor

        served = kept[:min_batch] if min_batch > 0 else kept

        meta_out = {
            "aggregated": True,
            "nextCursor": next_cursor,
            "served": len(served),
            "droppedByFilters": dropped,
            "hasMore": bool(next_cursor),
            "nsfw": nsfw,
            "sort": sort,
            "period": period,
            "videosOnly": videos_only,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "timeBudgetMs": time_budget_ms,
        }
        return web.json_response({"items": served, "metadata": meta_out})
    except Exception as e:
        return web.json_response({"error": f"Unhandled: {e}"}, status=500)


@prompt_server.routes.post("/civitai_gallery/check_video_workflow")
async def check_video_workflow(request):
    data = await request.json()
    video_url = data.get("url")
    if not video_url:
        return web.json_response({"has_workflow": False, "error": "URL is missing"}, status=400)
    try:
        headers = {"Range": "bytes=0-4194304"}
        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, headers=headers) as response:
                if response.status >= 400 and response.status != 416:
                    return web.json_response(
                        {"has_workflow": False, "error": f"Failed to fetch video chunk, status: {response.status}"}
                    )
                chunk = await response.content.read()
                has_workflow = b'"workflow":' in chunk or b'"prompt":' in chunk
                return web.json_response({"has_workflow": has_workflow})
    except Exception as e:
        return web.json_response({"has_workflow": False, "error": str(e)}, status=500)


@prompt_server.routes.get("/civitai_gallery/get_video_for_workflow")
async def get_video_for_workflow(request):
    video_url = request.query.get("url")
    if not video_url:
        return web.Response(status=400, text="Missing video URL")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(video_url) as response:
                if response.status != 200:
                    return web.Response(status=response.status, text=f"Failed to fetch video from source: {response.reason}")
                data = await response.read()
                filename = video_url.split("/")[-1].split("?")[0] or "video_with_workflow.mp4"
                return web.Response(
                    body=data,
                    content_type=response.content_type,
                    headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
                )
    except Exception as e:
        return web.Response(status=500, text=str(e))


# ----- SECTION: Entry Point (comfy_entrypoint) -----
class CivitaiDiscoveryHubExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[comfy_io.ComfyNode]]:
        return [CivitaiDiscoveryHubNode]


async def comfy_entrypoint() -> ComfyExtension:
    return CivitaiDiscoveryHubExtension()
