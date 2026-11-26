# ----- SECTION: Imports -----
import asyncio
import json
import logging
import sqlite3
import time
from urllib.error import HTTPError

import aiohttp
import torch
from aiohttp import web
from server import PromptServer

from comfy.cli_args import args as comfy_args
from comfy_api.latest import io as comfy_io
from . import favorites, media
from .gallery_filters import POSITIVE_PROMPT_KEYS, clamp_int, generation_meta, item_is_video, item_matches_query_local, positive_prompt, truthy


def _empty_image_tensor() -> torch.Tensor:
    return torch.zeros(1, 1, 1, 3, dtype=torch.float32)


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
    def execute(cls, selection_data: str):
        try:
            node_selection = json.loads(selection_data or "{}")
        except (TypeError, ValueError):
            node_selection = {}

        item_data = node_selection.get("item", {}) if isinstance(node_selection, dict) else {}
        should_download = truthy(node_selection.get("download_image", False)) if isinstance(node_selection, dict) else False

        meta = generation_meta(item_data)
        pos_prompt = positive_prompt(meta)
        neg_prompt = meta.get("negativePrompt") or meta.get("NegativePrompt") or meta.get("negative") or ""
        neg_prompt = str(neg_prompt or "")

        info_dict = dict(meta)
        for k in (*POSITIVE_PROMPT_KEYS, "negativePrompt", "NegativePrompt", "negative"):
            info_dict.pop(k, None)

        info_string = json.dumps(info_dict, indent=4, ensure_ascii=False)

        if should_download:
            if not isinstance(item_data, dict) or not item_data:
                raise ValueError("Select a Civitai gallery item before using the IMAGE output.")
            video = item_is_video(item_data)
            url = item_data.get("url")
            if video and item_data.get("type") != "video":
                url = next((meta[key] for key in ("videoUrl", "mp4Url", "video", "mp4")
                            if isinstance(meta.get(key), str) and meta[key]), url)
            tensor = media.image_tensor(url, video=video)
        else:
            tensor = _empty_image_tensor()

        return (pos_prompt, neg_prompt, tensor, info_string)


# ----- SECTION: Server Routes -----
prompt_server = PromptServer.instance


def _with_favorites(request, operation, params, write):
    manager = prompt_server.user_manager
    path = manager.get_request_user_filepath(request, favorites.PROFILE_DATABASE)
    if path is None:
        raise KeyError("Unknown profile")
    with favorites.open_database(path, import_legacy=not comfy_args.multi_user, write=write) as db:
        return operation(db, *params)


async def _favorites_response(request, operation, *params, write=False):
    try:
        data = await asyncio.to_thread(_with_favorites, request, operation, params, write)
    except favorites.InvalidFavorite as error:
        return web.json_response({"error": str(error)}, status=400)
    except favorites.FavoriteNotFound as error:
        return web.json_response({"error": str(error)}, status=404)
    except KeyError:
        return web.json_response({"error": "Unknown ComfyUI profile."}, status=403)
    except (OSError, ValueError, sqlite3.Error) as error:
        logging.getLogger(__name__).error("Favorites storage: %s", error)
        return web.json_response({"error": "Cannot read or save favorites. Check the ComfyUI log."}, status=500)
    return web.json_response(data)


async def _favorite_edit(request, operation):
    try:
        data = await request.json()
    except (ValueError, UnicodeError):
        return web.json_response({"error": "Invalid JSON."}, status=400)
    return await _favorites_response(request, favorites.change, data, operation, write=True)


@prompt_server.routes.get("/civitai_gallery/get_all_favorites_data")
async def get_all_favorites_data(request):
    return await _favorites_response(request, favorites.all_items)


@prompt_server.routes.get("/civitai_gallery/get_favorite_ids")
async def get_favorite_ids(request):
    return await _favorites_response(request, favorites.ids)


@prompt_server.routes.post("/civitai_gallery/toggle_favorite")
async def toggle_favorite(request):
    return await _favorite_edit(request, "toggle")


@prompt_server.routes.post("/civitai_gallery/add_or_update_favorite")
async def add_or_update_favorite(request):
    return await _favorite_edit(request, "update")


@prompt_server.routes.get("/civitai_gallery/get_favorites_images")
async def get_favorites_images(request):
    return await _favorites_response(request, favorites.page, dict(request.query))


@prompt_server.routes.post("/civitai_gallery/update_favorite_tags")
async def update_favorite_tags(request):
    return await _favorite_edit(request, "tags")


@prompt_server.routes.get("/civitai_gallery/get_all_favorite_tags")
async def get_all_favorite_tags(request):
    return await _favorites_response(request, favorites.all_tags)


@prompt_server.routes.get("/civitai_gallery/models")
async def search_models(request):
    query = request.query.get("query", "").strip()
    if not query:
        return web.json_response({"items": []})
    params = {"query": query, "limit": "30", "types": ["Checkpoint", "LORA"]}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://civitai.com/api/v1/models", params=params,
                                   timeout=aiohttp.ClientTimeout(total=12)) as response:
                if response.status != 200:
                    return web.json_response({"error": f"Civitai returned HTTP {response.status}."},
                                             status=response.status if 400 <= response.status < 600 else 502)
                data = await response.json(content_type=None)
    except TimeoutError:
        return web.json_response({"error": "Model search timed out."}, status=504)
    except (aiohttp.ClientError, ValueError):
        return web.json_response({"error": "Could not read Civitai model results."}, status=502)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return web.json_response({"error": "Invalid Civitai model results."}, status=502)
    items = [{"id": item["id"], "name": item["name"], "type": item["type"]}
             for item in data["items"] if isinstance(item, dict) and item.get("type") in ("Checkpoint", "LORA")
             and type(item.get("id")) is int and isinstance(item.get("name"), str)]
    return web.json_response({"items": items})


@prompt_server.routes.get("/civitai_gallery/images_stream")
async def get_civitai_images_stream(request):
    query = request.query
    params = {
        "nsfw": query.get("nsfw", "None").strip(),
        "sort": query.get("sort", "Most Reactions").strip(),
        "period": query.get("period", "Day").strip(),
        "withMeta": "true",
        "flatMeta": "true",
        "withTags": "true",
    }
    for key in ("username", "tags", "modelId", "modelVersionId"):
        value = query.get(key, "").strip()
        if value:
            params[key] = value

    videos_only = truthy(query.get("videos_only", "false"))
    if videos_only:
        params["type"] = "video"
    elif not truthy(query.get("include_videos", "false")):
        params["type"] = "image"
    hide_no_prompt = truthy(query.get("hide_no_prompt", "false"))
    search = query.get("query", "").strip()

    domain = "civitai.com" if truthy(query.get("international_version", "true")) else "civitai.work"
    url = f"https://{domain}/api/v1/images"
    batch = clamp_int(query.get("min_batch"), 1, 500, 50)
    budget_ms = clamp_int(query.get("time_budget_ms"), 0, 15000, 10000) or 10000
    started = time.monotonic()
    deadline = started + budget_ms / 1000
    cursor = query.get("cursor") or None
    seen_cursors = {cursor}
    kept = []
    dropped = 0

    try:
        async with aiohttp.ClientSession() as session:
            for page in range(50):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    if page:
                        break
                    raise TimeoutError
                params["limit"] = str(min(200, batch - len(kept)))
                if cursor:
                    params["cursor"] = cursor
                timeout = aiohttp.ClientTimeout(total=remaining, ceil_threshold=float("inf"))
                try:
                    async with session.get(url, params=params, timeout=timeout) as response:
                        if response.status != 200:
                            retry_after = response.headers.get("Retry-After")
                            headers = {"Retry-After": retry_after} if retry_after else {}
                            status = response.status if 400 <= response.status <= 599 else 502
                            return web.json_response({"error": f"Civitai returned HTTP {response.status}."}, status=status, headers=headers)
                        data = await response.json(content_type=None)
                except TimeoutError:
                    if page:
                        break
                    raise

                if not isinstance(data, dict) or not isinstance(data.get("items"), list) or not isinstance(data.get("metadata"), dict):
                    return web.json_response({"error": "Invalid gallery response from Civitai."}, status=502)
                for item in data["items"]:
                    if (
                        not isinstance(item, dict)
                        or item.get("type") == "audio"
                        or ("type" in params and item_is_video(item) != videos_only)
                        or (hide_no_prompt and not positive_prompt(generation_meta(item)))
                        or (search and not item_matches_query_local(item, search))
                    ):
                        dropped += 1
                    else:
                        if isinstance(item.get("meta"), dict):
                            item["meta"] = generation_meta(item)
                        kept.append(item)

                metadata = data["metadata"]
                cursor = metadata.get("nextCursor") or metadata.get("cursor") or metadata.get("next") or None
                if cursor is None:
                    break
                if not isinstance(cursor, (str, int)) or str(cursor) in seen_cursors:
                    return web.json_response({"error": "Civitai returned an invalid or repeated page cursor."}, status=502)
                cursor = str(cursor)
                seen_cursors.add(cursor)
                if len(kept) >= batch or (hide_no_prompt and kept):
                    break
    except TimeoutError:
        return web.json_response({"error": "Civitai did not respond in time."}, status=504)
    except (aiohttp.ClientError, ValueError):
        return web.json_response({"error": "Could not read the gallery response from Civitai."}, status=502)

    return web.json_response({
        "items": kept,
        "metadata": {
            "aggregated": True,
            "nextCursor": cursor,
            "served": len(kept),
            "droppedByFilters": dropped,
            "hasMore": cursor is not None,
            "nsfw": params["nsfw"],
            "sort": params["sort"],
            "period": params["period"],
            "videosOnly": videos_only,
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "timeBudgetMs": budget_ms,
        },
    })


@prompt_server.routes.post("/civitai_gallery/check_video_workflow")
async def check_video_workflow(request):
    try:
        data = await request.json()
        url = data.get("url") if isinstance(data, dict) else None
        with await asyncio.to_thread(media.download_media, url, media.WORKFLOW_PREFIX, prefix=True) as stream:
            chunk = await asyncio.to_thread(stream.read)
        return web.json_response({"has_workflow": b'"workflow":' in chunk or b'"prompt":' in chunk})
    except ValueError as exc:
        return web.json_response({"has_workflow": False, "error": str(exc)}, status=400)
    except OSError as exc:
        return web.json_response({"has_workflow": False, "error": "Civitai video could not be read."},
                                 status=exc.code if isinstance(exc, HTTPError) else 502)


@prompt_server.routes.get("/civitai_gallery/get_video_for_workflow")
async def get_video_for_workflow(request):
    try:
        stream = await asyncio.to_thread(media.download_media, request.query.get("url"), media.VIDEO_LIMIT)
    except ValueError as exc:
        return web.Response(status=400, text=str(exc))
    except OSError as exc:
        return web.Response(status=exc.code if isinstance(exc, HTTPError) else 502, text="Civitai video could not be read.")

    with stream:
        ext = "webm" if stream.read(4) == bytes.fromhex("1a45dfa3") else "mp4"
        stream.seek(0)
        response = web.StreamResponse(headers={
            "Content-Type": "video/" + ext,
            "Content-Disposition": f'attachment; filename="civitai-video.{ext}"',
            "X-Content-Type-Options": "nosniff",
        })
        await response.prepare(request)
        while chunk := await asyncio.to_thread(stream.read, 256 * 1024):
            await response.write(chunk)
        await response.write_eof()
        return response
