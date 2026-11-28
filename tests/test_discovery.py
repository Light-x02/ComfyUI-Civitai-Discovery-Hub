import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web

from hub_support import hub
from test_stream import Response, Session


def fetch(session, route=hub.get_civitai_images_stream, kind="", **query):
    request = SimpleNamespace(query=query, match_info={"kind": kind})
    with patch.object(hub.aiohttp, "ClientSession", return_value=session):
        try:
            route(request).send(None)
        except StopIteration as result:
            return result.value.status, json.loads(result.value.text)
    raise AssertionError("Unexpected unmocked I/O")


def images(items, cursor=None):
    return Response({"items": items, "metadata": {"nextCursor": cursor}})


class DiscoveryTests(unittest.TestCase):
    def test_model_search_limits_results_to_the_requested_type_with_or_without_a_name(self):
        records = [{"id": 10, "name": "Moon", "type": "Checkpoint"},
                   {"id": 11, "name": "Moon", "type": "LORA"}]
        for selected, name in (("Checkpoint", "Moon"), ("LORA", "")):
            with self.subTest(model_type=selected):
                session = Session(lambda params: Response({"items": records}))
                status, data = fetch(session, hub.search_models, modelType=selected, query=name, baseModels="Pony")
                self.assertEqual(status, 200)
                self.assertEqual(data["items"], [row for row in records if row["type"] == selected])
                params, = session.queries
                self.assertEqual(params["types"], [selected])
                self.assertEqual(params["baseModels"], "Pony")
                self.assertEqual(params.get("query"), name or None)
                self.assertEqual(params["limit"], "30")
        never = Session(lambda params: self.fail("Unexpected catalog request"))
        self.assertEqual(fetch(never, hub.search_models), (200, {"items": []}))
        self.assertEqual(fetch(never, hub.search_models, modelType="VAE")[0], 400)

    def test_public_catalog_paths_are_registered(self):
        app = web.Application()
        app.add_routes(hub.prompt_server.routes)
        resource = next(r for r in app.router.resources() if r.canonical == "/civitai_gallery/catalog/{kind}")
        pattern = resource.get_info()["pattern"]
        for kind in ("bases", "creators", "versions", "resource"):
            self.assertIsNotNone(pattern.fullmatch("/civitai_gallery/catalog/" + kind))
        self.assertIsNone(pattern.fullmatch("/civitai_gallery/catalog/models"))

    def test_model_catalog_counts_unique_matches_and_exposes_only_reliable_paging_information(self):
        one = {"id": 1, "type": "LORA", "name": "Ink"}
        two = {"id": 2, "type": "LORA", "name": "Ink XL"}
        for rows, remote, expected in (
            ([one, two], {"nextCursor": "more", "totalItems": 83}, {"hasMore": True, "totalItems": 83}),
            ([one, two], {"nextPage": "https://civitai.com/api/v1/models?cursor=2"}, {"hasMore": True}),
            ([], {"totalItems": 0}, {"hasMore": False, "totalItems": 0}),
            ([one, two], {"totalItems": 1}, {"hasMore": False}),
            ([one, one, two, {"id": 3, "type": "Checkpoint", "name": "Other"}],
             {"totalItems": 4}, {"hasMore": False}),
        ):
            with self.subTest(remote=remote):
                session = Session(lambda params: Response({"items": rows, "metadata": remote}))
                status, data = fetch(session, hub.search_models, query="Ink", modelType="LORA")
                self.assertEqual(status, 200)
                self.assertEqual(data["metadata"], expected)
                self.assertEqual(data["items"], [one, two] if rows else [])
                self.assertEqual(len(session.queries), 1)

    def test_base_and_version_filters_and_public_sorts(self):
        for sort in ("Oldest", "Most Collected", "Random"):
            session = Session(lambda p: images([{"id": 4}]))
            status, data = fetch(session, sort=sort, baseModels="ZImageTurbo", modelId="3", modelVersionId="7")
            self.assertEqual((status, data["items"]), (200, [{"id": 4}]))
            self.assertEqual([session.queries[0][k] for k in ("sort", "baseModels", "modelId", "modelVersionId")],
                             [sort, "ZImageTurbo", "3", "7"])

    def test_random_fallback_keeps_filters_and_continues_the_sample(self):
        def feed(p):
            if p["sort"] == "Random":
                return Response({"message": "Random sort requires a collectionId"}, 400)
            self.assertEqual(p["sort"], "Newest")
            self.assertEqual(p["modelId"], "71")
            self.assertEqual(p["limit"], "8")
            start = 8 if p.get("cursor") else 0
            return images([{"id": i} for i in range(start, start + 8)], None if start else "more")

        session = Session(feed)
        status, first = fetch(session, sort="Random", modelId="71", min_batch="4")
        self.assertEqual(status, 200)
        self.assertTrue(first["metadata"]["sampled"])
        self.assertEqual(len({i["id"] for i in first["items"]}), 4)
        before = len(session.queries)
        _, second = fetch(session, sort="Random", modelId="71", min_batch="4", cursor=first["metadata"]["nextCursor"])
        self.assertEqual(len(session.queries), before + 1)
        self.assertEqual(session.queries[-1]["cursor"], "more")
        self.assertTrue(all(item["id"] >= 8 for item in second["items"]))
        self.assertIsNone(second["metadata"]["nextCursor"])
        limited = Session(lambda p: Response({}, 429))
        self.assertEqual(fetch(limited, sort="Random")[0], 429)
        self.assertEqual(len(limited.queries), 1)

    def test_multiple_tags_require_every_tag_even_if_upstream_returns_any(self):
        session = Session(lambda p: images([{"id": 10, "tags": [{"id": 4}, {"id": 9}]},
                                             {"id": 11, "tags": [{"id": 4}]}, {"id": 12}]))
        _, body = fetch(session, tags="4,9")
        self.assertEqual([i["id"] for i in body["items"]], [10])
        self.assertEqual(body["metadata"]["droppedByFilters"], 2)

    def test_direct_lookup_includes_video_and_never_substitutes_another_image_or_post(self):
        rows = [{"id": 6, "postId": 9}, {"id": 7, "postId": 12, "type": "video"}]
        session = Session(lambda p: images(rows, "other"))
        _, data = fetch(session, imageId="7", include_videos="true")
        self.assertEqual(data["items"], rows[1:])
        self.assertNotIn("type", session.queries[0])
        self.assertEqual(session.queries[0]["limit"], "1")
        self.assertIsNone(data["metadata"]["nextCursor"])
        _, data = fetch(Session(lambda p: images(rows)), postId="9", include_videos="true")
        self.assertEqual(data["items"], rows[:1])
        for query in ({"postId": "0"}, {"imageId": "https://civitai.com/images/7"},
                      {"ids": "1,,2"}, {"ids": ",".join(["1"] * 101)}):
            self.assertEqual(fetch(Session(lambda p: self.fail("upstream called")), **query)[0], 400)

    def test_saved_draw_returns_only_available_requested_ids_in_one_request(self):
        session = Session(lambda p: images([{"id": i} for i in [3, 8, 12]], "irrelevant"))
        _, data = fetch(session, ids="8,4,3")
        self.assertEqual({i["id"] for i in data["items"]}, {3, 8})
        self.assertIsNone(data["metadata"]["nextCursor"])
        self.assertEqual(len(session.queries), 1)

    def test_catalog_shapes_and_model_versions(self):
        cases = [
            ("creators", {"query": " ali "}, {"items": [{"username": "Alice"}]}, {"items": ["Alice"]}),
            ("bases", {}, {"BaseModel": ["ZImageTurbo", "Flux.1 D"]}, {"items": ["Flux.1 D", "ZImageTurbo"]}),
            ("versions", {"id": "7"}, {"modelVersions": [{"id": 11, "name": "V2", "baseModel": "Pony", "files": [1]}]},
             {"items": [{"id": 11, "name": "V2", "baseModel": "Pony"}]}),
            ("resource", {"id": "11"}, {"modelName": "Portrait", "versionName": "V2", "files": [1]},
             {"name": "Portrait", "version": "V2"}),
        ]
        for kind, query, remote, expected in cases:
            with self.subTest(kind=kind):
                self.assertEqual(fetch(Session(lambda p: Response(remote)), hub.get_catalog, kind, **query), (200, expected))
        never = Session(lambda p: self.fail("unexpected catalog call"))
        self.assertEqual(fetch(never, hub.get_catalog, "creators", query="A"), (200, {"items": []}))
        self.assertEqual(fetch(never, hub.get_catalog, "resource", id="../models")[0], 400)
        session = Session(lambda p: Response({"items": [{"id": 7, "type": "LORA", "name": "Example",
                           "modelVersions": [{"id": 11, "name": "V2", "files": [1]}]}]}))
        _, data = fetch(session, hub.search_models, query="example", baseModels="ZImageTurbo")
        self.assertEqual(session.queries[0]["baseModels"], "ZImageTurbo")
        self.assertEqual(data["items"][0]["versions"], [{"id": 11, "name": "V2"}])
