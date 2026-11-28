"""SQLite storage and legacy import for Civitai favorites."""
import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path

from .gallery_filters import civitai_tag_ids, clamp_int, generation_meta, item_is_video, positive_prompt, truthy


PROFILE_DATABASE = "civitai-discovery-hub/favorites.sqlite3"
LEGACY_FILE = Path(__file__).with_name("civitai_favorites.json")
_FAVORITE_LEVELS = {"None": 1, "Soft": 2, "Mature": 4, "X": 8, "XXX": 16}
_FAVORITE_MAX_LEVEL = {"None": 1, "Soft": 2, "Mature": 4, "X": 16}
_FAVORITE_PERIODS = {"Day": 1, "Week": 7, "Month": 30, "Year": 365}


# Relative SQLite date literals such as "now" cannot appear in an expression index.
_CREATED_DATE = "CASE WHEN created GLOB '[0-9]*' THEN julianday(created) END"


def _favorite_row(item_id, item):
    level = item.get("browsingLevel")
    if level is None:
        level = item.get("nsfwLevel")
    if isinstance(level, str):
        level = int(level) if level in ("1", "2", "4", "8", "16") else _FAVORITE_LEVELS.get(level, 32)
    if level is None and item.get("nsfw") is False:
        level = 1
    elif level is None and item.get("nsfw") is True:
        level = 16
    if type(level) is not int or level not in _FAVORITE_LEVELS.values():
        level = 32
    user = item.get("user")
    username = item.get("username") or (user.get("username") if isinstance(user, dict) else user)
    stats = item.get("stats")
    stats = stats if isinstance(stats, dict) else {}
    def count(key):
        value = stats.get(key)
        return value if isinstance(value, int) and 0 <= value < 2**60 else 0
    reactions = sum(count(key) for key in ("likeCount", "heartCount", "laughCount", "cryCount", "dislikeCount"))
    return (item_id, json.dumps(item, ensure_ascii=False, separators=(",", ":")),
            str(username or "").casefold(), level, item_is_video(item), bool(positive_prompt(generation_meta(item))),
            item.get("createdAt") if isinstance(item.get("createdAt"), str) else None,
            reactions, count("commentCount"), json.dumps(sorted(civitai_tag_ids(item))))


def _store_favorite(db, item_id, item):
    db.execute(
        """INSERT INTO favorite (id, data, author, level, video, prompt, created, reactions, comments, tag_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data=excluded.data, author=excluded.author, level=excluded.level,
             video=excluded.video, prompt=excluded.prompt, created=excluded.created, reactions=excluded.reactions,
             comments=excluded.comments, tag_ids=excluded.tag_ids""",
        _favorite_row(item_id, item),
    )


def _initialize_favorites(db, legacy):
    if db.execute("PRAGMA user_version").fetchone()[0] == 4:
        return
    db.execute("BEGIN IMMEDIATE")
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version == 0:
        db.execute("""CREATE TABLE favorite (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, author TEXT, level INTEGER, video INTEGER, prompt INTEGER,
            created TEXT, reactions INTEGER, comments INTEGER, tag_ids TEXT)""")
        if legacy is not None:
            try:
                with open(legacy, encoding="utf-8") as file:
                    previous = json.load(file)
            except FileNotFoundError:
                previous = {}
            if not isinstance(previous, dict):
                raise ValueError("Invalid favorites collection")
            for key, item in previous.items():
                if not isinstance(item, dict) or str(item.get("id")) != key:
                    raise ValueError("Invalid favorite in the old collection")
                _store_favorite(db, key, item)
    elif version == 1:
        rows = db.execute("SELECT rowid, data, prompt FROM favorite ORDER BY rowid")
        for rowid, data, old_prompt in rows:
            has_prompt = bool(positive_prompt(generation_meta(json.loads(data))))
            if has_prompt != old_prompt:
                db.execute("UPDATE favorite SET prompt=? WHERE rowid=?", (has_prompt, rowid))
    elif version not in (2, 3, 4):
        raise ValueError("Unsupported favorites database version")
    if version < 2:
        db.execute(f"CREATE INDEX favorite_created ON favorite ({_CREATED_DATE})")
    if version < 3:
        db.execute("CREATE TABLE favorite_collection (key TEXT PRIMARY KEY, name TEXT NOT NULL)")
        db.execute("""CREATE TABLE collection_item (
            collection_key TEXT NOT NULL REFERENCES favorite_collection(key) ON DELETE CASCADE,
            favorite_id TEXT NOT NULL REFERENCES favorite(id) ON DELETE CASCADE,
            PRIMARY KEY (collection_key, favorite_id)) WITHOUT ROWID""")
        db.execute("CREATE INDEX collection_item_favorite ON collection_item (favorite_id)")
        db.execute("CREATE TABLE saved_search (key TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL)")
    if version < 4:
        db.execute("ALTER TABLE favorite_collection ADD COLUMN cover_id TEXT REFERENCES favorite(id) ON DELETE SET NULL")
        db.execute("PRAGMA user_version=4")
    db.commit()


class InvalidFavorite(ValueError):
    pass


class FavoriteNotFound(LookupError):
    pass


@contextmanager
def open_database(path, *, import_legacy, write):
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        _initialize_favorites(db, LEGACY_FILE if import_legacy else None)
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db


def all_items(db):
    return {key: json.loads(data) for key, data in db.execute("SELECT id, data FROM favorite ORDER BY rowid")}


def ids(db):
    return {"ids": [key for (key,) in db.execute("SELECT id FROM favorite")]}


def rating_ceiling(value):
    return _FAVORITE_MAX_LEVEL.get(value, 1)


def _favorite_id(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return ""
    return str(value).strip()


def change(db, data, operation):
    if not isinstance(data, dict):
        raise InvalidFavorite("Invalid favorite data")
    item = data.get("item")
    source = data if operation == "tags" else item
    item_id = _favorite_id(source.get("id")) if isinstance(source, dict) else ""
    if not item_id:
        raise InvalidFavorite("Missing favorite id")

    if operation == "tags":
        row = db.execute("SELECT data, tag_ids FROM favorite WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise FavoriteNotFound("Item not in favorites")
        tags = data.get("tags")
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            raise InvalidFavorite("Invalid favorite tags")
        item = json.loads(row[0])
        item["civitaiTagIds"] = json.loads(row[1])
        item["tags"] = tags
    elif operation == "toggle":
        exists = db.execute("SELECT 1 FROM favorite WHERE id=?", (item_id,)).fetchone() is not None
        desired = data.get("favorite", not exists)
        if not isinstance(desired, bool):
            raise InvalidFavorite("Invalid favorite state")
        if not desired:
            db.execute("DELETE FROM favorite WHERE id=?", (item_id,))
            return {"status": "removed"}
        if exists:
            return {"status": "added"}
        tag = data.get("tag_id")
        if isinstance(tag, (str, int)) and str(tag).isdecimal():
            existing = item.get("civitaiTagIds")
            item["civitaiTagIds"] = [*(existing if isinstance(existing, list) else []), str(tag)]
        if not isinstance(item.get("meta"), dict):
            item["meta"] = {}
        item["meta"].pop("prompt_saved", None)
        if not isinstance(item.get("tags"), list):
            item["tags"] = []

    _store_favorite(db, item_id, item)
    return {"status": "added" if operation == "toggle" else "success"}


def page(db, query):
    limit = clamp_int(query.get("limit", 50), 1, 200, 50)
    page = clamp_int(query.get("page", 1), 1, 1_000_000, 1)
    offset = clamp_int(query.get("offset", (page - 1) * limit), 0, 2**31-1, 0)
    conditions = []
    values = []
    if collection := query.get("collection", "").strip():
        conditions.append("id IN (SELECT favorite_id FROM collection_item WHERE collection_key=?)")
        values.append(collection.casefold())
    if "nsfw" in query:
        conditions.append("level <= ?")
        values.append(rating_ceiling(query["nsfw"]))
    if "videos_only" in query:
        conditions.append("video = ?")
        values.append(truthy(query["videos_only"]))
    if truthy(query.get("hide_no_prompt")):
        conditions.append("prompt = 1")
    if username := query.get("username", "").strip():
        conditions.append("author = ?")
        values.append(username.casefold())
    if base := query.get("baseModels"):
        conditions.append("coalesce(json_extract(data, '$.baseModel'), json_extract(data, '$.meta.baseModel')) = ?")
        values.append(base)
    if ids := query.get("ids"):
        conditions.append("id IN (SELECT value FROM json_each(?))")
        values.append(json.dumps(ids.split(",")))
    if days := _FAVORITE_PERIODS.get(query.get("period")):
        conditions.append(f"{_CREATED_DATE} >= julianday('now') - ?")
        values.append(days)
    for tag in filter(None, (value.strip() for value in query.get("tags", "").split(","))):
        conditions.append("EXISTS (SELECT 1 FROM json_each(tag_ids) WHERE value = ?)")
        values.append(tag)

    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    order = {"Newest": f"{_CREATED_DATE} DESC, rowid DESC", "Oldest": f"{_CREATED_DATE} ASC NULLS LAST, rowid",
             "Random": "random()", "Most Reactions": "reactions DESC, rowid DESC",
             "Most Comments": "comments DESC, rowid DESC"}.get(query.get("sort"), "rowid")
    total = db.execute("SELECT COUNT(*) FROM favorite" + where, values).fetchone()[0]
    rows = db.execute("SELECT data FROM favorite" + where + " ORDER BY " + order + " LIMIT ? OFFSET ?",
                      [*values, limit, offset])
    items = [json.loads(data) for (data,) in rows]
    next_offset = offset + len(items)
    return {"items": items, "metadata": {
        "totalItems": total, "currentPage": offset // limit + 1, "pageSize": limit,
        "totalPages": (total + limit - 1) // limit, "nextOffset": next_offset if next_offset < total else None,
    }}


def all_tags(db):
    tags = set()
    for (data,) in db.execute("SELECT data FROM favorite"):
        values = json.loads(data).get("tags")
        if isinstance(values, list):
            tags.update(value.strip() for value in values if isinstance(value, str) and value.strip())
    return {"tags": sorted(tags, key=str.casefold)}
