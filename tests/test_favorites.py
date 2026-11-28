import asyncio
import json
import sqlite3
from contextlib import closing
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hub_support import hub


@unittest.skipUnless(hub.favorite_storage.os.name == "nt", "Windows Documents folder")
class WindowsDocumentsTests(unittest.TestCase):
    def test_default_follows_the_users_redirected_documents_folder(self):
        registry = hub.favorite_storage.winreg
        with patch.object(registry, "OpenKey"), patch.object(registry, "QueryValueEx") as personal:
            for documents in (Path("E:/Users/Artist/Documents"), Path("M:/OneDrive/Mes documents")):
                personal.return_value = (str(documents), registry.REG_SZ)
                self.assertEqual(hub.favorite_storage.default_folder(), documents / "Comfyui Light_x02" / "Civitai Discovery Hub")


class Request:
    method = "GET"
    remote = "127.0.0.1"
    host = "localhost:8188"
    scheme = "http"
    headers = {}
    content_type = "application/json"

    def __init__(self, profile="default", data=None, **query):
        self.profile = profile
        self.data = data
        self.query = query

    async def json(self):
        return self.data


class FavoritesTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.legacy = self.directory / "legacy.json"
        self.default = self.directory / "Documents" / "Comfyui Light_x02" / "Civitai Discovery Hub"
        self.enterContext(patch.object(hub.favorite_storage, "default_folder", return_value=self.default))
        self.enterContext(patch.object(hub.favorite_storage, "get_system_user_directory", return_value=self.directory / "settings"))
        self.enterContext(patch.object(hub.favorites, "LEGACY_FILE", self.legacy))
        self.enterContext(patch.object(hub.comfy_args, "multi_user", False))
        manager = SimpleNamespace(get_request_user_filepath=self.profile_path)
        self.enterContext(patch.object(hub.prompt_server, "user_manager", manager, create=True))

    def profile_path(self, request, name):
        path = self.directory / request.profile / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def toggle(self, identifier, *, profile="default", desired=True, **fields):
        item = {"id": identifier, **fields}
        response = await hub.toggle_favorite(Request(profile, {"item": item, "favorite": desired}))
        self.assertEqual(response.status, 200, response.text)
        return json.loads(response.text)["status"]

    async def ids(self, profile="default"):
        response = await hub.get_favorite_ids(Request(profile))
        self.assertEqual(response.status, 200, response.text)
        return set(json.loads(response.text)["ids"])

    async def page(self, **query):
        response = await hub.get_favorites_images(Request(**query))
        self.assertEqual(response.status, 200, response.text)
        return json.loads(response.text)

    async def library_edit(self, kind, action, name, *, profile="default", status=200, **fields):
        request = Request(profile, {"action": action, "name": name, **fields})
        request.path = "/civitai_gallery/" + kind
        result = await hub.edit_gallery_library(request)
        self.assertEqual(result.status, status, result.text)
        return json.loads(result.text)

    async def test_filing_updates_membership_without_copying_or_removing_favorites(self):
        for identifier in (7, 8, 9):
            await self.toggle(identifier, nsfw=False, meta={"prompt": "landscape"})
        await self.library_edit("collections", "create", "Éclairages", favoriteId="7")
        await self.library_edit("collections", "create", "Références", favoriteId="7")
        await self.library_edit("collections", "create", "éclairages", status=400)
        await self.library_edit("collections", "create", "Missing", favoriteId="123", status=404)
        for _ in range(2):
            await self.library_edit("collections", "membership", "Éclairages", favoriteId="8", member=True)
        listing = json.loads((await hub.get_collections(Request(favoriteId="7"))).text)
        self.assertTrue(listing["favorite"])
        self.assertEqual({i["name"]: (i["count"], i["contains"]) for i in listing["items"]},
                         {"Éclairages": (2, True), "Références": (1, True)})
        first = await self.page(collection="Éclairages", nsfw="None", limit="1", hide_no_prompt="true")
        self.assertEqual(first["metadata"]["totalPages"], 2)
        self.assertEqual([i["id"] for i in (await self.page(collection="éclairages", ids="7,9"))["items"]], [7])
        await self.library_edit("collections", "membership", "Éclairages", favoriteId="7", member=False)
        self.assertEqual([i["id"] for i in (await self.page(collection="Références"))["items"]], [7])
        await self.library_edit("collections", "delete", "Références")
        self.assertEqual(await self.ids(), {"7", "8", "9"})
        await self.toggle(8, desired=False)
        await self.toggle(8)
        self.assertEqual((await self.page(collection="Éclairages"))["items"], [])

    async def test_collection_and_search_survive_v2_upgrade_and_folder_moves(self):
        await self.toggle(10, meta={"prompt": "Forest"})
        with closing(sqlite3.connect(self.default / "favorites.sqlite3")) as db, db:
            for table in ("collection_item", "favorite_collection", "saved_search"):
                db.execute(f"DROP TABLE {table}")
            db.execute("PRAGMA user_version=2")
        settings = {"filters": {"collection": "Forest", "favorites_only": True, "hide_no_prompt": True}}
        await self.library_edit("collections", "create", "Forest", favoriteId="10")
        await self.library_edit("collections", "create", "Empty")
        await self.library_edit("searches", "create", "Prompts", settings=settings)
        moved = self.directory / "Other folder"
        for target in (moved, self.default):
            self.assertEqual((await self.set_folder(target)).status, 200)
            self.assertEqual((await self.page(collection="Forest"))["items"][0]["meta"]["prompt"], "Forest")
            self.assertEqual(json.loads((await hub.get_saved_searches(Request())).text)["items"][0]["settings"], settings)
            self.assertEqual(len(json.loads((await hub.get_collections(Request())).text)["items"]), 2)
        with hub.favorites.open_database(moved / "favorites.sqlite3", import_legacy=False, write=True) as db:
            self.assertEqual(hub.gallery_library.saved_searches(db)["items"], [])
            hub.gallery_library.edit_search(db, {"action": "create", "name": "Existing", "settings": settings})
        self.assertEqual((await self.set_folder(moved)).status, 400)
        self.assertEqual(await self.ids(), {"10"})

    async def test_cover_choices_respect_rating_membership_and_folder_relocation(self):
        async def cover(rating):
            data = json.loads((await hub.get_collections(Request(nsfw=rating))).text)
            return data["items"][0]["coverUrl"]

        image = {"id": 15, "nsfwLevel": "Mature", "url": "https://image.civitai.com/15.jpg"}
        safe = {"id": 6, "nsfw": False, "url": "https://image.civitai.com/6.png"}
        result = await self.library_edit("collections", "create", "Portraits", favoriteId="15", item=image)
        self.assertTrue(result["favoriteAdded"])
        await self.library_edit("collections", "membership", "Portraits", favoriteId="6", member=True, item=safe)
        await self.library_edit("collections", "cover", "Portraits", favoriteId="15")
        self.assertEqual(await cover("Mature"), image["url"])
        self.assertEqual(await cover("None"), safe["url"])
        self.assertEqual((await self.set_folder(self.directory / "Moved")).status, 200)
        row = json.loads((await hub.get_collections(Request(favoriteId="15"))).text)["items"][0]
        self.assertTrue(row["isCover"])
        self.assertIsNone(row["coverUrl"])
        self.assertEqual(await cover("Mature"), image["url"])
        await self.library_edit("collections", "membership", "Portraits", favoriteId="15", member=False)
        self.assertEqual(await self.ids(), {"15", "6"})
        self.assertEqual(await cover("Mature"), safe["url"])
        await self.library_edit("collections", "cover", "Portraits", favoriteId="15", status=400)
        await self.library_edit("collections", "cover", "Portraits", favoriteId="6")
        await self.toggle(6, desired=False)
        self.assertIsNone(await cover("Mature"))

    async def test_old_collections_gain_covers_and_invalid_additions_leave_no_partial_changes(self):
        await self.toggle(42, nsfw=False, url="https://image.civitai.com/42.jpg")
        await self.library_edit("collections", "create", "Original", favoriteId="42")
        with closing(sqlite3.connect(self.default / "favorites.sqlite3")) as db, db:
            db.execute("ALTER TABLE favorite_collection DROP COLUMN cover_id")
            db.execute("PRAGMA user_version=3")
        await self.library_edit("collections", "cover", "Original", favoriteId="42")
        await self.library_edit("collections", "create", "Wrong ID", favoriteId="14", item={"id": 43}, status=404)
        video = {"id": 17, "type": "video", "nsfw": False, "url": "https://image.civitai.com/17.mp4"}
        await self.library_edit("collections", "membership", "Original", favoriteId="17", member=True, item=video)
        await self.library_edit("collections", "cover", "Original", favoriteId="17", status=400)
        rows = json.loads((await hub.get_collections(Request())).text)["items"]
        self.assertEqual([(r["name"], r["count"], r["coverUrl"]) for r in rows],
                         [("Original", 2, "https://image.civitai.com/42.jpg")])
        self.assertEqual(await self.ids(), {"17", "42"})

    async def test_saved_search_edits_and_collection_lists_are_profile_scoped(self):
        hub.comfy_args.multi_user = True
        settings = {"filters": {"sort": "Random", "tags": "3,7"}, "model": {"id": "21"}}
        await self.library_edit("searches", "create", "My search", profile="alice", settings=settings)
        await self.library_edit("searches", "create", "MY SEARCH", profile="alice", settings=settings, status=400)
        settings["model"]["version"] = {"id": "41"}
        await self.library_edit("searches", "update", "My search", profile="alice", settings=settings)
        await self.library_edit("collections", "create", "Personal", profile="alice")
        self.assertEqual(json.loads((await hub.get_saved_searches(Request("alice"))).text)["items"],
                         [{"name": "My search", "settings": settings}])
        self.assertEqual(json.loads((await hub.get_saved_searches(Request("bob"))).text)["items"], [])
        self.assertEqual(json.loads((await hub.get_collections(Request("bob"))).text)["items"], [])
        await self.library_edit("searches", "delete", "My search", profile="alice")
        await self.library_edit("searches", "update", "My search", profile="alice", settings=settings, status=404)
        self.assertEqual(json.loads((await hub.get_saved_searches(Request("alice"))).text)["items"], [])

    async def test_single_user_migration_only_once_and_preserves_source(self):
        previous = '{"17":{"id":17,"meta":{"prompt":"Forest"}}}'
        self.legacy.write_text(previous, encoding="utf-8")
        self.assertEqual(await self.ids(), {"17"})
        self.assertEqual(await self.toggle(17, desired=False), "removed")
        self.assertEqual(await self.ids(), set())
        self.assertEqual(self.legacy.read_text(encoding="utf-8"), previous)

    async def set_folder(self, folder):
        request = Request(data={"folder": str(folder)})
        request.method = "POST"
        return await hub.favorites_location(request)

    async def test_storage_tab_moves_the_collection_and_returns_to_documents(self):
        old = self.profile_path(Request(), hub.favorites.PROFILE_DATABASE)
        with hub.favorites.open_database(old, import_legacy=False, write=True) as db:
            hub.favorites.change(db, {"item": {"id": 7, "meta": {"prompt": "forest"}}}, "update")
        details = json.loads((await hub.favorites_location(Request())).text)
        self.assertEqual(details["defaultFolder"], str(self.default))
        self.assertEqual(details["defaultLabel"], "Documents/Comfyui Light_x02/Civitai Discovery Hub")
        self.assertEqual(await self.ids(), {"7"})
        target = self.directory / "Mes favoris"
        result = await self.set_folder(target)
        self.assertEqual(result.status, 200, result.text)
        self.assertEqual(Path(json.loads(result.text)["folder"]), target)
        self.assertEqual((await self.page())["items"][0]["meta"]["prompt"], "forest")
        await self.toggle(7, desired=False)
        await self.toggle(8)
        self.assertEqual((await self.set_folder(self.default)).status, 200)
        self.assertEqual(await self.ids(), {"8"})
        with closing(sqlite3.connect(target / "favorites.sqlite3")) as db:
            self.assertEqual(hub.favorites.ids(db), {"ids": []})
        with closing(sqlite3.connect(old)) as db:
            self.assertEqual(hub.favorites.ids(db), {"ids": ["7"]})
        listing = json.loads((await hub.favorites_location(Request(browse=str(self.directory)))).text)
        self.assertIn((target.name, target), [(entry["name"], Path(entry["path"])) for entry in listing["children"]])

    async def test_folder_move_rolls_back_and_never_overwrites_an_occupied_destination(self):
        await self.toggle(1)
        target = self.directory / "target"
        target.mkdir()
        target_db = target / "favorites.sqlite3"
        with hub.favorites.open_database(target_db, import_legacy=False, write=True) as db:
            hub.favorites.change(db, {"item": {"id": 99}}, "update")
        self.assertEqual((await self.set_folder(target)).status, 400)
        with closing(sqlite3.connect(target_db)) as db, db:
            self.assertEqual(hub.favorites.ids(db), {"ids": ["99"]})
            db.execute("DELETE FROM favorite")
        with hub.favorite_storage.settings() as db:
            db.execute("CREATE TRIGGER interrupted BEFORE INSERT ON location BEGIN SELECT RAISE(ABORT,'interrupted'); END")
        with self.assertLogs(hub.__name__, "WARNING"):
            result = await self.set_folder(target)
        self.assertEqual(result.status, 409)
        self.assertEqual(await self.ids(), {"1"})
        with closing(sqlite3.connect(target_db)) as db:
            self.assertEqual(hub.favorites.ids(db), {"ids": []})
        self.assertEqual(hub.favorite_storage.location_info()["folder"], str(self.default))

    async def test_concurrent_stars_follow_the_folder_move(self):
        await self.toggle(1)
        target = self.directory / "new"
        result, *_ = await asyncio.gather(self.set_folder(target), *(self.toggle(i) for i in range(2, 15)))
        self.assertEqual(result.status, 200)
        self.assertEqual(await self.ids(), {str(i) for i in range(1, 15)})
        self.assertEqual(Path(hub.favorite_storage.location_info()["folder"]), target)

    async def test_remote_and_multiuser_requests_do_not_expose_host_folders(self):
        request = Request(browse=str(self.directory))
        request.remote = "192.0.2.1"
        self.assertEqual((await hub.favorites_location(request)).status, 403)
        request.remote = "::1"
        request.headers = {"Origin": "https://example.org"}
        self.assertEqual((await hub.favorites_location(request)).status, 403)
        hub.comfy_args.multi_user = True
        self.assertEqual((await hub.favorites_location(Request())).status, 403)
        self.assertEqual(list(self.directory.iterdir()), [])

    async def test_v1_migration_keeps_favorites_and_indexes_newest(self):
        await self.toggle(10, createdAt="2025-01-01", meta={"id": 10, "meta": {"prompt": "forest"}})
        await self.toggle(11, createdAt="2026-01-01", meta={"prompt": {"graph": {}}})
        await self.toggle(12, createdAt="now")
        path = self.default / "favorites.sqlite3"
        with closing(sqlite3.connect(path)) as db, db:
            for table in ("collection_item", "favorite_collection", "saved_search"):
                db.execute(f"DROP TABLE {table}")
            db.execute("DROP INDEX favorite_created")
            db.execute("PRAGMA user_version=1")
            db.execute("UPDATE favorite SET prompt=(id='11')")
            before = dict(db.execute("SELECT id, data FROM favorite"))
        self.assertEqual([i["id"] for i in (await self.page(sort="Newest"))["items"]], [11, 10, 12])
        self.assertEqual([i["id"] for i in (await self.page(hide_no_prompt="true"))["items"]], [10])
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 4)
            self.assertEqual(dict(db.execute("SELECT id, data FROM favorite")), before)
            query = f"SELECT data FROM favorite ORDER BY {hub.favorites._CREATED_DATE} DESC, rowid DESC LIMIT 24"
            self.assertTrue(any("favorite_created" in row[-1] for row in db.execute("EXPLAIN QUERY PLAN " + query)))

    async def test_multiuser_profiles_never_import_shared_json(self):
        hub.comfy_args.multi_user = True
        self.legacy.write_text("unassigned shared data", encoding="utf-8")
        await self.toggle(7, profile="alice")
        self.assertEqual(await self.ids("bob"), set())
        self.assertEqual(await self.ids("default"), set())
        self.assertEqual(await self.ids("alice"), {"7"})

    async def test_invalid_favorite_returns_bad_request_without_saving(self):
        result = await hub.toggle_favorite(Request(data={"item": {"id": 18}, "favorite": "yes"}))
        self.assertEqual(result.status, 400)
        self.assertEqual(json.loads(result.text), {"error": "Invalid favorite state"})
        self.assertEqual(await self.ids(), set())

    async def test_unknown_profile_returns_forbidden_before_opening_the_database(self):
        with patch.object(hub.prompt_server.user_manager, "get_request_user_filepath", return_value=None):
            result = await hub.get_favorite_ids(Request())
        self.assertEqual(result.status, 403)
        self.assertEqual(list(self.directory.iterdir()), [])

    async def test_invalid_legacy_file_blocks_edits_until_repaired(self):
        self.legacy.write_text('{"17":', encoding="utf-8")
        request = Request(data={"item": {"id": 18}})
        with self.assertLogs(hub.__name__, "ERROR"):
            result = await hub.toggle_favorite(request)
        self.assertEqual(result.status, 500)
        self.assertEqual(self.legacy.read_text(encoding="utf-8"), '{"17":')
        self.legacy.write_text('{"17":{"id":17}}', encoding="utf-8")
        self.assertEqual(await self.ids(), {"17"})

    async def test_disk_error_never_returns_added(self):
        blocked = self.directory / "regular-file"
        blocked.write_text("", encoding="utf-8")
        with patch.object(hub.prompt_server.user_manager, "get_request_user_filepath", return_value=blocked / "db"):
            with self.assertLogs(hub.__name__, "ERROR"):
                result = await hub.toggle_favorite(Request(data={"item": {"id": 1}}))
        self.assertEqual(result.status, 500)
        self.assertNotIn("added", result.text)

    async def test_parallel_edits_and_idempotent_desired_state(self):
        await asyncio.gather(*(self.toggle(i) for i in range(20)))
        self.assertEqual(await self.ids(), {str(i) for i in range(20)})
        await asyncio.gather(self.toggle(3, desired=False), self.toggle(3, desired=False))
        self.assertNotIn("3", await self.ids())
        self.assertEqual(await self.toggle(3), "added")
        self.assertEqual(await self.toggle(3), "added")
        self.assertIn("3", await self.ids())

    async def test_filtered_pagination_respects_stored_metadata(self):
        today = datetime.now(timezone.utc).isoformat()
        await self.toggle(1, username="ALICE", browsingLevel=1, tags=[{"id": 42}], createdAt=today,
                          meta={"prompt": "Lake"}, stats={"heartCount": 10, "commentCount": 1})
        await self.toggle(2, username="Alice", nsfwLevel="Soft", tagIds=[42], createdAt=today,
                          meta={"prompt": "Clouds"}, stats={"likeCount": 2, "commentCount": 9})
        await self.toggle(3, username="Alice", nsfw=True, tags=[{"id": 42}], createdAt=today)
        await self.toggle(4, username="Alice", browsingLevel=1, tags=[{"id": 42}], createdAt="2020-01-01")
        await self.toggle(5, username="Bob", nsfwLevel="None", tags=[{"id": 42}], createdAt=today)
        await self.toggle(6, username="Alice", browsingLevel=1, tags=[{"id": 17}], createdAt=today)
        await self.toggle(7, username="Alice", browsingLevel=1, tags=[{"id": 42}], createdAt=today,
                          url="https://example.invalid/scene.mp4", meta={"prompt": "Lights"})
        filters = dict(nsfw="Soft", username="alice", tags="42", period="Week", videos_only="false",
                       hide_no_prompt="true", sort="Most Reactions", limit="1")
        first = await self.page(**filters)
        self.assertEqual([it["id"] for it in first["items"]], [1])
        self.assertEqual(first["metadata"]["totalItems"], 2)
        self.assertEqual(first["metadata"]["nextOffset"], 1)
        second = await self.page(**filters, offset="1")
        self.assertEqual([it["id"] for it in second["items"]], [2])
        self.assertIsNone(second["metadata"]["nextOffset"])
        self.assertEqual((await self.page(**{**filters, "sort": "Most Comments"}))["items"][0]["id"], 2)
        self.assertEqual((await self.page(**{**filters, "videos_only": "true"}))["items"][0]["id"], 7)
        self.assertEqual((await self.page(**{**filters, "nsfw": "None"}))["metadata"]["totalItems"], 1)

    async def test_known_remote_tag_and_legacy_tag_routes(self):
        await self.toggle(2, tags=["42"])
        self.assertEqual((await self.page(tags="42"))["metadata"]["totalItems"], 0)
        await self.toggle(2, desired=False)
        req = Request(data={"item": {"id": 1, "nsfw": False}, "favorite": True, "tag_id": "42"})
        self.assertEqual((await hub.toggle_favorite(req)).status, 200)
        self.assertEqual((await self.page(tags="42"))["metadata"]["totalItems"], 1)
        edited = await hub.update_favorite_tags(Request(data={"id": 1, "tags": ["Scenery"]}))
        self.assertEqual(edited.status, 200)
        all_tags = await hub.get_all_favorite_tags(Request())
        self.assertEqual(json.loads(all_tags.text), {"tags": ["Scenery"]})
        self.assertEqual((await self.page(tags="42"))["metadata"]["totalItems"], 1)
        removed = await hub.update_favorite_tags(Request(data={"id": 2, "tags": []}))
        self.assertEqual(removed.status, 404)

    async def test_rating_thresholds_match_civitai(self):
        for level in (1, 2, 4, 8, 16, 32):
            await self.toggle(level, browsingLevel=level)
        await self.toggle(40)
        for threshold, allowed in (("None", [1]), ("Soft", [1, 2]), ("Mature", [1, 2, 4]), ("X", [1, 2, 4, 8, 16])):
            rows = (await self.page(nsfw=threshold))["items"]
            self.assertEqual(sorted(row["id"] for row in rows), allowed)

    async def test_base_tags_oldest_and_saved_random_selection(self):
        for id, base, tags, date in [(1, "ZImageTurbo", [3, 7], "2022-02-02"), (2, "SDXL", [3, 7], "2021-01-01"),
                                      (3, "ZImageTurbo", [3], "2022-01-01"), (4, "ZImageTurbo", [3, 7], "2020-01-01")]:
            await self.toggle(id, baseModel=base, tagIds=tags, createdAt=date, nsfw=False)
        filters = {"baseModels": "ZImageTurbo", "tags": "3,7"}
        self.assertEqual([i["id"] for i in (await self.page(sort="Oldest", **filters))["items"]], [4, 1])
        draw = await self.page(sort="Random", limit="1", **filters)
        self.assertEqual(len(draw["items"]), 1)
        self.assertIn(draw["items"][0]["id"], [1, 4])
        saved = await self.page(ids="4,2", **filters)
        self.assertEqual([i["id"] for i in saved["items"]], [4])
