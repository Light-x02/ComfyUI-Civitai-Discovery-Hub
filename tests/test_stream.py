import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from hub_support import hub


class Response:
    def __init__(self, data, status=200, headers=None):
        self.data = data
        self.status = status
        self.headers = headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        pass

    async def json(self, **kwargs):
        return self.data


class Session:
    def __init__(self, handler):
        self.handler = handler
        self.queries = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        pass

    def get(self, url, *, params, timeout):
        self.queries.append(dict(params))
        return self.handler(params)


class GalleryStreamTests(unittest.TestCase):
    def fetch(self, session, **query):
        request = SimpleNamespace(query=query)
        with patch.object(hub.aiohttp, "ClientSession", return_value=session):
            # All upstream I/O is mocked, so the route completes without yielding.
            with self.assertRaises(StopIteration) as result:
                hub.get_civitai_images_stream(request).send(None)
        response = result.exception.value
        return response, json.loads(response.text)

    def test_model_lookup_returns_selectable_checkpoints_and_loras(self):
        records = [{"id": 12, "type": "Checkpoint", "name": "Example", "modelVersions": []},
                   {"id": 13, "type": "LORA", "name": "Example"},
                   {"id": 14, "type": "VAE", "name": "Example"}]
        session = Session(lambda params: Response({"items": records}))
        with patch.object(hub.aiohttp, "ClientSession", return_value=session):
            with self.assertRaises(StopIteration) as result:
                hub.search_models(SimpleNamespace(query={"query": " Example "})).send(None)
        self.assertEqual(session.queries, [{"query": "Example", "limit": "30", "types": ["Checkpoint", "LORA"],
                                            "primaryFileOnly": "true"}])
        self.assertEqual(json.loads(result.exception.value.text)["items"], [
            {"id": 12, "type": "Checkpoint", "name": "Example"}, {"id": 13, "type": "LORA", "name": "Example"}])

    def test_all_batch_sizes_preserve_every_item_and_order(self):
        items = [{"id": i, "type": "image"} for i in range(413)]

        def page(params):
            start = int(params.get("cursor", 0))
            end = min(len(items), start + int(params["limit"]))
            return Response({"items": items[start:end], "metadata": {"nextCursor": str(end) if end < len(items) else None}})

        for size in (24, 50, 100, 150, 500):
            with self.subTest(size=size):
                session = Session(page)
                result = []
                cursor = ""
                for _ in range(len(items) + 1):
                    response, body = self.fetch(session, min_batch=str(size), cursor=cursor)
                    self.assertEqual(response.status, 200)
                    self.assertLessEqual(len(body["items"]), size)
                    result.extend(body["items"])
                    cursor = body["metadata"]["nextCursor"]
                    if not body["metadata"]["hasMore"]:
                        break
                self.assertEqual(result, items)
                self.assertIsNone(cursor)
                self.assertLessEqual(max(int(p["limit"]) for p in session.queries), 200)

    def test_filters_request_metadata_and_match_the_api_fields(self):
        session = Session(lambda params: Response({"items": [
            {"id": 1, "type": "video", "url": "https://example.test/asset", "username": "Alice",
             "meta": {"prompt": "scene"}, "tags": [{"id": 4}, {"id": 6}]},
            {"id": 2, "type": "video", "meta": None},
            {"id": 3, "type": "image", "meta": {"positive": "scene"}},
        ], "metadata": {}}))
        _, body = self.fetch(session, videos_only="true", hide_no_prompt="true", query="alice", tags="4,6")
        self.assertEqual([i["id"] for i in body["items"]], [1])
        query = session.queries[0]
        self.assertEqual(query["withTags"], "true")
        self.assertEqual({k: query[k] for k in ("type", "withMeta", "flatMeta", "tags")}, {
            "type": "video", "withMeta": "true", "flatMeta": "true", "tags": "4,6",
        })

    def test_with_prompt_skips_empty_pages_and_selects_only_reusable_text(self):
        def images(params):
            self.assertNotIn("requiringMeta", params)
            self.assertEqual(params["withMeta"], "true")
            self.assertEqual(params["modelId"], "7")
            if not params.get("cursor"):
                items = [{"id": 1, "meta": {"negativePrompt": "noise"}},
                         {"id": 2, "meta": {"prompt": {"13": {"inputs": {}}}}}]
                return Response({"items": items, "metadata": {"nextCursor": "more"}})
            items = [{"id": 3, "meta": {"id": 3, "meta": {"prompt": "  ", "positivePrompt": "garden"}}},
                     {"id": 4, "meta": {"prompt": "lake", "negativePrompt": "blur"}},
                     {"id": 5, "meta": {"prompt": " "}}]
            return Response({"items": items, "metadata": {"nextCursor": "next"}})

        session = Session(images)
        response, body = self.fetch(session, modelId="7", hide_no_prompt="true")
        self.assertEqual(response.status, 200)
        self.assertEqual([x["id"] for x in body["items"]], [3, 4])
        self.assertEqual(body["metadata"]["nextCursor"], "next")
        self.assertEqual(len(session.queries), 2)
        texts = [hub.CivitaiDiscoveryHubNode.execute(json.dumps({"item": x}))[0:2] for x in body["items"]]
        self.assertEqual(texts, [("garden", ""), ("lake", "blur")])

    def test_timeout_after_empty_filtered_page_preserves_the_cursor(self):
        def page(params):
            if params.get("cursor"):
                raise TimeoutError
            return Response({"items": [{"id": 1, "meta": None}], "metadata": {"nextCursor": "page2"}})

        response, body = self.fetch(Session(page), hide_no_prompt="true")
        self.assertEqual(response.status, 200)
        self.assertEqual(body["items"], [])
        self.assertTrue(body["metadata"]["hasMore"])
        self.assertEqual(body["metadata"]["nextCursor"], "page2")

    def test_budget_stops_on_time_even_without_a_match(self):
        session = Session(lambda p: Response({"items": [], "metadata": {"nextCursor": "page2"}}))
        clock = SimpleNamespace(monotonic=iter((100, 100, 102, 102)).__next__)
        with patch.object(hub, "time", clock):
            response, body = self.fetch(session, time_budget_ms="1200")
        self.assertEqual(response.status, 200)
        self.assertEqual(len(session.queries), 1)
        self.assertEqual(body["metadata"]["nextCursor"], "page2")

    def test_rate_limit_malformed_response_and_first_page_timeout(self):
        def timeout(params):
            raise TimeoutError

        for handler, status in (
            (lambda p: Response({}, 429, {"Retry-After": "30"}), 429),
            (lambda p: Response({"items": None}), 502),
            (timeout, 504),
        ):
            with self.subTest(status=status):
                response, body = self.fetch(Session(handler))
                self.assertEqual(response.status, status)
                self.assertTrue(body["error"])
                if status == 429:
                    self.assertEqual(response.headers["Retry-After"], "30")

    def test_repeated_cursor_is_reported(self):
        session = Session(lambda params: Response({"items": [], "metadata": {"nextCursor": "again"}}))
        response, _ = self.fetch(session, cursor="again")
        self.assertEqual(response.status, 502)
        self.assertEqual(len(session.queries), 1)
