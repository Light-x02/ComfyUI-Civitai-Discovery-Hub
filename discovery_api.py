"""Small public catalog lookups used by the gallery controls."""
import aiohttp
from aiohttp import web


def catalog_id(value):
    return isinstance(value, str) and value.isascii() and value.isdecimal() and 0 < len(value) <= 16 and int(value) > 0


def version_options(data):
    options = []
    for row in data.get("modelVersions", []):
        if not isinstance(row, dict) or type(row.get("id")) is not int or not isinstance(row.get("name"), str):
            continue
        option = {"id": row["id"], "name": row["name"]}
        if isinstance(row.get("baseModel"), str):
            option["baseModel"] = row["baseModel"]
        options.append(option)
    return options


async def get_catalog(request):
    kind = request.match_info["kind"]
    params = {}
    if kind == "creators":
        query = request.query.get("query", "").strip()
        if len(query) < 2:
            return web.json_response({"items": []})
        path = "creators"
        params = {"query": query, "limit": "8"}
    elif kind == "bases":
        path = "enums"
    else:
        identifier = request.query.get("id", "")
        if not catalog_id(identifier):
            return web.json_response({"error": "Invalid Civitai ID."}, status=400)
        path = ("models/" if kind == "versions" else "model-versions/mini/") + identifier

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://civitai.com/api/v1/" + path, params=params,
                                   timeout=aiohttp.ClientTimeout(total=12)) as response:
                if response.status != 200:
                    return web.json_response({"error": f"Civitai returned HTTP {response.status}."},
                                             status=response.status if 400 <= response.status < 600 else 502)
                data = await response.json(content_type=None)
        if kind == "bases" and isinstance(data, dict) and isinstance(data.get("BaseModel"), list):
            result = {"items": sorted({value for value in data["BaseModel"] if isinstance(value, str)}, key=str.casefold)}
        elif kind == "creators" and isinstance(data, dict) and isinstance(data.get("items"), list):
            result = {"items": [row["username"] for row in data["items"]
                                if isinstance(row, dict) and isinstance(row.get("username"), str)]}
        elif kind == "versions" and isinstance(data, dict) and isinstance(data.get("modelVersions"), list):
            result = {"items": version_options(data)}
        elif kind == "resource" and isinstance(data, dict) and isinstance(data.get("modelName"), str):
            result = {"name": data["modelName"], "version": data.get("versionName")}
        else:
            return web.json_response({"error": "Invalid Civitai catalog response."}, status=502)
        return web.json_response(result)
    except TimeoutError:
        return web.json_response({"error": "Civitai did not respond in time."}, status=504)
    except (aiohttp.ClientError, ValueError):
        return web.json_response({"error": "Could not read the Civitai catalog."}, status=502)
