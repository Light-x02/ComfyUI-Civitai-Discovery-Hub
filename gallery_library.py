"""Local favorite collections and named gallery searches in the profile's favorites database."""
import json

from .favorites import FavoriteNotFound, InvalidFavorite, change, rating_ceiling


def _name(data):
    name = data.get("name") if isinstance(data, dict) else None
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise InvalidFavorite("Enter a name between 1 and 80 characters.")
    return name.strip()


def collections(db, favorite_id, nsfw="None"):
    favorite = db.execute("SELECT 1 FROM favorite WHERE id=?", (favorite_id,)).fetchone() is not None
    ceiling = rating_ceiling(nsfw)
    rows = db.execute("""SELECT c.name,
        (SELECT COUNT(*) FROM collection_item WHERE collection_key=c.key),
        EXISTS (SELECT 1 FROM collection_item WHERE collection_key=c.key AND favorite_id=:id),
        c.cover_id=:id, json_extract(cover.data, '$.url')
        FROM favorite_collection c LEFT JOIN favorite cover ON :id IS NULL AND cover.id=coalesce(
            (SELECT id FROM favorite WHERE id=c.cover_id AND video=0 AND level<=:ceiling),
            (SELECT f.id FROM collection_item m JOIN favorite f ON f.id=m.favorite_id
             WHERE m.collection_key=c.key AND f.video=0 AND f.level<=:ceiling AND json_type(f.data, '$.url')='text'
             ORDER BY m.favorite_id LIMIT 1))
        ORDER BY c.key""", {"id": favorite_id, "ceiling": ceiling})
    return {"favorite": favorite, "items": [
        {"name": name, "count": count, "contains": bool(contains), "isCover": bool(is_cover), "coverUrl": url}
        for name, count, contains, is_cover, url in rows]}


def edit_collection(db, data):
    name = _name(data)
    key = name.casefold()
    action = data.get("action")
    if action == "delete":
        db.execute("DELETE FROM favorite_collection WHERE key=?", (key,))
        return {"name": name}
    favorite_id = data.get("favoriteId")
    if action == "create":
        if not db.execute("INSERT INTO favorite_collection (key, name) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                          (key, name)).rowcount:
            raise InvalidFavorite("A collection with this name already exists.")
        if favorite_id is None:
            return {"name": name}
        member = True
    elif action == "cover":
        if not isinstance(favorite_id, str):
            raise InvalidFavorite("Choose an image that belongs to this collection.")
        row = db.execute("""UPDATE favorite_collection SET cover_id=? WHERE key=? AND EXISTS (
            SELECT 1 FROM collection_item m JOIN favorite f ON f.id=m.favorite_id
            WHERE m.collection_key=? AND m.favorite_id=? AND f.video=0 AND json_type(f.data, '$.url')='text')""",
                         (favorite_id, key, key, favorite_id))
        if not row.rowcount:
            raise InvalidFavorite("Choose an image that belongs to this collection.")
        return {"name": name}
    elif action == "membership" and isinstance(data.get("member"), bool):
        member = data["member"]
        if not db.execute("SELECT 1 FROM favorite_collection WHERE key=?", (key,)).fetchone():
            raise FavoriteNotFound("This collection no longer exists.")
    else:
        raise InvalidFavorite("Invalid collection action.")
    if not isinstance(favorite_id, str) or not favorite_id:
        raise InvalidFavorite("Missing favorite ID.")
    added = False
    if not db.execute("SELECT 1 FROM favorite WHERE id=?", (favorite_id,)).fetchone():
        item = data.get("item")
        if not member or not isinstance(item, dict) or str(item.get("id")) != favorite_id:
            raise FavoriteNotFound("This item is no longer in Favorites.")
        change(db, {"item": item, "favorite": True, "tag_id": data.get("tag_id")}, "toggle")
        added = True
    if member:
        db.execute("INSERT INTO collection_item VALUES (?, ?) ON CONFLICT DO NOTHING", (key, favorite_id))
    else:
        db.execute("DELETE FROM collection_item WHERE collection_key=? AND favorite_id=?", (key, favorite_id))
        db.execute("UPDATE favorite_collection SET cover_id=NULL WHERE key=? AND cover_id=?", (key, favorite_id))
    return {"name": name, "favoriteAdded": added}


def saved_searches(db):
    rows = db.execute("SELECT name, settings FROM saved_search ORDER BY key")
    return {"items": [{"name": name, "settings": json.loads(settings)} for name, settings in rows]}


def edit_search(db, data):
    name = _name(data)
    key = name.casefold()
    action = data.get("action")
    if action == "delete":
        db.execute("DELETE FROM saved_search WHERE key=?", (key,))
    elif action in ("create", "update"):
        settings = data.get("settings")
        if not isinstance(settings, dict) or not isinstance(settings.get("filters"), dict):
            raise InvalidFavorite("Missing gallery filters.")
        encoded = json.dumps(settings, ensure_ascii=False, separators=(",", ":"))
        if len(encoded) > 16384:
            raise InvalidFavorite("Saved search settings are too large.")
        if action == "create":
            if not db.execute("INSERT INTO saved_search VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
                              (key, name, encoded)).rowcount:
                raise InvalidFavorite("This name is already used. Select the saved search to update it.")
        elif not db.execute("UPDATE saved_search SET settings=? WHERE key=?", (encoded, key)).rowcount:
            raise FavoriteNotFound("This saved search no longer exists.")
    else:
        raise InvalidFavorite("Invalid saved search action.")
    return {"name": name}
