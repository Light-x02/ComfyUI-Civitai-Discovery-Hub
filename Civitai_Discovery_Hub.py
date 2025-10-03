import server
from aiohttp import web
import aiohttp
import os
import json
import torch
import numpy as np
from PIL import Image
import io
import urllib.request
import folder_paths
import asyncio
import time
from typing import Dict, Any, List, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# FILES (Favorites uniquement)
# ─────────────────────────────────────────────────────────────────────────────
NODE_DIR = os.path.dirname(os.path.abspath(__file__))
FAVORITES_FILE = os.path.join(NODE_DIR, "civitai_favorites.json")

def load_favorites() -> Dict[str, Any]:
    if not os.path.exists(FAVORITES_FILE):
        return {}
    try:
        with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_favorites(data: Dict[str, Any]) -> None:
    try:
        with open(FAVORITES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"CivitaiGallery: Error saving favorites: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────────────────────────────────────
def clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(str(v))
    except Exception:
        return default
    return max(lo, min(hi, n))

def truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")

def get_full_filename_list(folder_key):
    file_list = []
    for folder_path in folder_paths.get_folder_paths(folder_key):
        if os.path.exists(folder_path):
            for _root, _dirs, files in os.walk(folder_path, followlinks=True):
                for file in files:
                    file_list.append(file)
    return list(set(file_list))

def nsfw_union(level: str) -> List[str]:
    order = ["None", "Soft", "Mature", "X"]
    level = (level or "none").strip().lower()
    if level == "none":
        return order[:1]
    if level == "soft":
        return order[:2]
    if level == "mature":
        return order[:3]
    if level == "x":
        return order[:4]
    return order[:1]

def key_reaction_count(item: Dict[str, Any]) -> int:
    stats = item.get("stats") or {}
    keys = ["reactionCount", "heartCount", "likeCount", "laughCount", "cryCount", "favoriteCount", "loveCount", "wowCount"]
    return sum(int(stats.get(k, 0) or 0) for k in keys)

def key_comment_count(item: Dict[str, Any]) -> int:
    stats = item.get("stats") or {}
    return int(stats.get("commentCount", 0) or 0)

def key_created_at(item: Dict[str, Any]) -> str:
    return str(item.get("createdAt") or "")

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
        str(x or "") for x in [
            it.get("id"), it.get("url"),
            m.get("prompt"), m.get("Prompt"), m.get("textPrompt"),
            m.get("negativePrompt"), m.get("NegativePrompt"),
            (it.get("user") or {}).get("username") or (it.get("user") or {}).get("name") or "",
            m.get("Model") or m.get("model") or "",
        ]
    ).lower()
    return q in buf

# ─────────────────────────────────────────────────────────────────────────────
# NODE (prompts + image + info)
# ─────────────────────────────────────────────────────────────────────────────
class CivitaiDiscoveryHubNode:
    @classmethod
    def IS_CHANGED(cls, selection_data, **kwargs):
        return selection_data

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "selection_data": ("STRING", {"default": "{}", "multiline": True, "forceInput": True}),
                "civitai_gallery_unique_id_widget": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "IMAGE", "STRING",)
    RETURN_NAMES = ("positive_prompt", "negative_prompt", "image", "info",)
    FUNCTION = "get_selected_data"
    CATEGORY = "📜Asset Gallery/Civitai"

    def get_selected_data(self, unique_id, civitai_gallery_unique_id_widget="", selection_data="{}"):
        try:
            node_selection = json.loads(selection_data)
        except Exception:
            node_selection = {}

        item_data = node_selection.get("item", {}) if isinstance(node_selection, dict) else {}
        should_download = bool(node_selection.get("download_image", False)) if isinstance(node_selection, dict) else False

        meta = item_data.get("meta", {}) if item_data else {}
        pos_prompt = (meta.get("prompt") or meta.get("Prompt") or meta.get("positive") or meta.get("textPrompt") or "")
        neg_prompt = (meta.get("negativePrompt") or meta.get("NegativePrompt") or meta.get("negative") or "")
        image_url = item_data.get("url", "") if item_data else ""

        info_dict = dict(meta) if isinstance(meta, dict) else {}
        for k in ("prompt", "Prompt", "positive", "textPrompt", "negativePrompt", "NegativePrompt", "negative"):
            info_dict.pop(k, None)
        info_string = json.dumps(info_dict, indent=4, ensure_ascii=False)

        tensor = torch.zeros(1, 1, 1, 3)
        if should_download and image_url:
            try:
                req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=30) as response:
                    img_data = response.read()
                img = Image.open(io.BytesIO(img_data)).convert("RGB")
                img_array = np.array(img).astype(np.float32) / 255.0
                tensor = torch.from_numpy(img_array)[None, ...]
            except Exception as e:
                print(f"CivitaiGallery: Failed to download/process {image_url} -> {e}")
        elif should_download:
            print("CivitaiGallery: Image output connected but no URL provided/selected.")

        return (pos_prompt, neg_prompt, tensor, info_string,)

# ─────────────────────────────────────────────────────────────────────────────
# SERVER ROUTES
# ─────────────────────────────────────────────────────────────────────────────
prompt_server = server.PromptServer.instance

# ---------- FAVORITES ----------
@prompt_server.routes.get("/civitai_gallery/get_all_favorites_data")
async def get_all_favorites_data(request):
    favorites = load_favorites()
    return web.json_response(favorites)

@prompt_server.routes.post("/civitai_gallery/toggle_favorite")
async def toggle_favorite(request):
    try:
        data = await request.json()
        item = data.get("item")
        if not item or 'id' not in item:
            return web.json_response({"status": "error", "message": "Invalid item data"}, status=400)
        item_id = str(item['id'])
        favorites = load_favorites()
        if item_id in favorites:
            del favorites[item_id]
            status = "removed"
        else:
            if 'meta' not in item or item['meta'] is None:
                item['meta'] = {}
            if 'tags' not in item:
                item['tags'] = []
            item['meta'].pop('prompt_saved', None)
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
        if not item or 'id' not in item:
            return web.json_response({"status": "error", "message": "Invalid item data"}, status=400)
        item_id = str(item['id'])
        favorites = load_favorites()
        favorites[item_id] = item
        save_favorites(favorites)
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@prompt_server.routes.get("/civitai_gallery/get_favorites_images")
async def get_favorites_images(request):
    try:
        page = clamp_int(request.query.get('page', '1'), 1, 1_000_000, 1)
        limit = clamp_int(request.query.get('limit', '50'), 1, 200, 50)

        favorites = load_favorites()
        items = list(favorites.values())

        total_items = len(items)
        start_index = (page - 1) * limit
        end_index = start_index + limit
        paginated_items = items[start_index:end_index]

        response_data = {
            "items": paginated_items,
            "metadata": {
                "totalItems": total_items,
                "currentPage": page,
                "pageSize": limit,
                "totalPages": (total_items + limit - 1) // limit,
            }
        }
        return web.json_response(response_data)
    except Exception as e:
        print(f"CivitaiGallery: get_favorites_images error: {e}")
        return web.json_response({"error": str(e)}, status=500)

@prompt_server.routes.post("/civitai_gallery/update_favorite_tags")
async def update_favorite_tags(request):
    try:
        data = await request.json()
        item_id = str(data.get("id"))
        tags = data.get("tags", [])
        if not item_id:
            return web.json_response({"status": "error", "message": "Missing item id"}, status=400)

        favorites = load_favorites()
        if item_id in favorites:
            favorites[item_id]['tags'] = tags
            save_favorites(favorites)
            return web.json_response({"status": "success"})
        else:
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
                for tag in tags:
                    all_tags.add(tag)
        sorted_tags = sorted(list(all_tags), key=lambda s: s.lower())
        return web.json_response({"tags": sorted_tags})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# ---------- IMAGES STREAM (défilement infini) ----------
@prompt_server.routes.get("/civitai_gallery/images_stream")
async def get_civitai_images_stream(request):
    """
    Flux infini basé sur 'cursor' (pas de pages).
    Optimisations:
      - videos_only=True -> limit amont plus grand (200)
      - time_budget_ms : coupe l'agrégation quand le délai est atteint (si au moins 1 item trouvé)
    Réponse: { items: [...], metadata: { nextCursor, aggregated: true, served, droppedByFilters, hasMore, elapsedMs, ... } }
    """
    try:
        # filtres usuels
        nsfw     = (request.query.get('nsfw', 'None') or '').strip()
        sort     = (request.query.get('sort', 'Most Reactions') or '').strip()
        period   = (request.query.get('period', 'Day') or '').strip()
        username = (request.query.get('username', '') or '').strip()
        tags_q   = (request.query.get('tags', '') or '').strip()
        query_q  = (request.query.get('query', '') or '').strip()

        include_videos = truthy(request.query.get('include_videos', 'false'))
        hide_no_prompt = truthy(request.query.get('hide_no_prompt', 'false'))
        videos_only    = truthy(request.query.get('videos_only', 'false'))

        # curseur + taille minimale de lot renvoyé
        cursor    = request.query.get('cursor', None)
        min_batch = clamp_int(request.query.get('min_batch', '50'), 1, 500, 50)

        # délai max pour renvoyer un premier lot (0 = désactivé)
        time_budget_ms = clamp_int(request.query.get('time_budget_ms', '0'), 0, 15000, 0)
        deadline = (time.monotonic() + (time_budget_ms / 1000.0)) if time_budget_ms > 0 else None

        # domaine (optionnel): civitai.com (international) vs civitai.work
        international_version = truthy(request.query.get('international_version', 'true'))
        base_domain = "civitai.com" if international_version else "civitai.work"
        base_url = f"https://{base_domain}/api/v1/images"

        # support optionnel pour modelId / modelVersionId
        model_id = request.query.get('modelId', '').strip() or None
        model_ver_id = request.query.get('modelVersionId', '').strip() or None

        # on tire plus large en mode vidéo pour limiter les allers/retours
        upstream_limit = 200 if videos_only else 100

        def build_params(cur: str | None) -> Dict[str, str]:
            p = {
                "limit": str(upstream_limit),
                "nsfw": nsfw,
                "sort": sort,
                "period": period,
            }
            if username: p["username"] = username
            if tags_q:   p["tags"] = tags_q
            if query_q:  p["query"] = query_q
            if model_id: p["modelId"] = model_id
            if model_ver_id: p["modelVersionId"] = model_ver_id
            if cur: p["cursor"] = cur
            return p

        async def fetch_once(session: aiohttp.ClientSession, cur: str | None):
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
                return {"items": items, "metadata": md, "next": nxt}

        started = time.monotonic()
        kept: List[Dict[str, Any]] = []
        dropped = 0
        next_cursor = None

        async with aiohttp.ClientSession() as session:
            cur = cursor
            for _ in range(50):  # garde-fou
                res = await fetch_once(session, cur)
                rec_items = res["items"] if isinstance(res, dict) else []
                next_cursor = res.get("next", None)

                for it in rec_items:
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

                # assez d'items ?
                if len(kept) >= min_batch:
                    break

                # time budget: si dépassé et on a déjà au moins 1 item, on renvoie tout de suite
                if deadline is not None and time.monotonic() >= deadline and len(kept) > 0:
                    break

                # plus de page suivante ?
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
            "nsfw": nsfw, "sort": sort, "period": period,
            "videosOnly": videos_only,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "timeBudgetMs": time_budget_ms,
        }
        return web.json_response({"items": served, "metadata": meta_out})

    except Exception as e:
        return web.json_response({"error": f"Unhandled: {e}"}, status=500)

# ---------- VIDEO / WORKFLOW helpers (inchangé) ----------
@prompt_server.routes.post("/civitai_gallery/check_video_workflow")
async def check_video_workflow(request):
    data = await request.json()
    video_url = data.get("url")
    if not video_url:
        return web.json_response({"has_workflow": False, "error": "URL is missing"}, status=400)
    try:
        headers = {'Range': 'bytes=0-4194304'}
        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, headers=headers) as response:
                if response.status >= 400 and response.status != 416:
                    return web.json_response({"has_workflow": False, "error": f"Failed to fetch video chunk, status: {response.status}"})
                chunk = await response.content.read()
                has_workflow = b'"workflow":' in chunk or b'"prompt":' in chunk
                return web.json_response({"has_workflow": has_workflow})
    except Exception as e:
        return web.json_response({"has_workflow": False, "error": str(e)}, status=500)

@prompt_server.routes.get("/civitai_gallery/get_video_for_workflow")
async def get_video_for_workflow(request):
    video_url = request.query.get('url')
    if not video_url:
        return web.Response(status=400, text="Missing video URL")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(video_url) as response:
                if response.status != 200:
                    return web.Response(status=response.status, text=f"Failed to fetch video from source: {response.reason}")
                data = await response.read()
                filename = video_url.split('/')[-1].split('?')[0] or "video_with_workflow.mp4"
                return web.Response(
                    body=data,
                    content_type=response.content_type,
                    headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
                )
    except Exception as e:
        return web.Response(status=500, text=str(e))

# ─────────────────────────────────────────────────────────────────────────────
# NODE REGISTRATION
# ─────────────────────────────────────────────────────────────────────────────
NODE_CLASS_MAPPINGS = {"CivitaiDiscoveryHubNode": CivitaiDiscoveryHubNode}
NODE_DISPLAY_NAME_MAPPINGS = {"CivitaiDiscoveryHubNode": "🖼️ Civitai Discovery Hub"}
