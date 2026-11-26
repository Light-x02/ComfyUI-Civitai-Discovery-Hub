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


class Request:
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

    async def test_single_user_migration_only_once_and_preserves_source(self):
        previous = '{"17":{"id":17,"meta":{"prompt":"Forest"}}}'
        self.legacy.write_text(previous, encoding="utf-8")
        self.assertEqual(await self.ids(), {"17"})
        self.assertEqual(await self.toggle(17, desired=False), "removed")
        self.assertEqual(await self.ids(), set())
        self.assertEqual(self.legacy.read_text(encoding="utf-8"), previous)

    async def test_v1_migration_keeps_favorites_and_indexes_newest(self):
        await self.toggle(10, createdAt="2025-01-01", meta={"id": 10, "meta": {"prompt": "forest"}})
        await self.toggle(11, createdAt="2026-01-01", meta={"prompt": {"graph": {}}})
        await self.toggle(12, createdAt="now")
        path = self.profile_path(Request(), hub.favorites.PROFILE_DATABASE)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("DROP INDEX favorite_created")
            db.execute("PRAGMA user_version=1")
            db.execute("UPDATE favorite SET prompt=(id='11')")
            before = dict(db.execute("SELECT id, data FROM favorite"))
        self.assertEqual([i["id"] for i in (await self.page(sort="Newest"))["items"]], [11, 10, 12])
        self.assertEqual([i["id"] for i in (await self.page(hide_no_prompt="true"))["items"]], [10])
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)
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
