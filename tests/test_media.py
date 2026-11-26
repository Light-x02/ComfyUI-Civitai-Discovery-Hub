import io
import json
from unittest import TestCase
from unittest.mock import Mock, patch

import av
import numpy as np
from PIL import Image

from hub_support import hub


media = hub.media
URL = "https://image.civitai.com/example/media"


class MediaTests(TestCase):
    def test_png_and_exif_oriented_jpeg(self):
        for mode, expected in [("PNG", (1, 2, 3, 3)), ("JPEG", (1, 3, 2, 3))]:
            with self.subTest(mode=mode):
                stream = io.BytesIO()
                source = Image.new("RGB", (3, 2), "red")
                exif = source.getexif()
                exif[274] = 6 if mode == "JPEG" else 1
                source.save(stream, mode, exif=exif)
                stream.seek(0)
                with patch.object(media, "download_media", return_value=stream):
                    tensor = media.image_tensor(URL)
                self.assertEqual(tuple(tensor.shape), expected)
                self.assertGreater(tensor[0, 0, 0, 0].item(), 0.98)

    def test_video_first_frame(self):
        data = io.BytesIO()
        with av.open(data, "w", format="mp4") as container:
            stream = container.add_stream("mpeg4", rate=1)
            stream.width, stream.height = 16, 16
            for rgb in [(255, 0, 0), (0, 0, 255)]:
                image = np.full((16, 16, 3), rgb, dtype=np.uint8)
                for packet in stream.encode(av.VideoFrame.from_ndarray(image, format="rgb24")):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        data.seek(0)
        with patch.object(media, "download_media", return_value=data):
            tensor = media.image_tensor(URL, video=True)
        self.assertEqual(tuple(tensor.shape), (1, 16, 16, 3))
        self.assertGreater(tensor[0, 0, 0, 0].item(), 0.95)
        self.assertLess(tensor[0, 0, 0, 2].item(), 0.05)

    def test_unreadable_media_fails_instead_of_returning_a_black_pixel(self):
        selection = {"item": {"url": URL}, "download_image": True}
        with patch.object(media, "download_media", return_value=io.BytesIO(b"ordinary test text")):
            with self.assertRaisesRegex(ValueError, "unreadable image"):
                hub.CivitaiDiscoveryHubNode.execute(json.dumps(selection))

    def test_text_outputs_do_not_fetch_a_media(self):
        item = {"url": URL, "meta": {"Prompt": "forest", "negativePrompt": "blur", "seed": 141}}
        with patch.object(media, "download_media") as download:
            pos, neg, tensor, info = hub.CivitaiDiscoveryHubNode.execute(json.dumps({"item": item, "download_image": False}))
        download.assert_not_called()
        self.assertEqual((pos, neg, json.loads(info)), ("forest", "blur", {"seed": 141}))
        self.assertEqual(tuple(tensor.shape), (1, 1, 1, 3))

    def test_prefix_and_full_body_are_bounded_without_content_length(self):
        for prefix, expected in ((True, b"ab"), (False, None)):
            response = io.BytesIO(b"abc")
            response.headers = {}
            opener = Mock()
            opener.open.return_value = response
            with patch.object(media, "build_opener", return_value=opener):
                if prefix:
                    with media.download_media(URL, 2, prefix=True) as file:
                        self.assertEqual(file.read(), expected)
                else:
                    with self.assertRaisesRegex(ValueError, "limit"):
                        media.download_media(URL, 2)

    def test_rejects_an_unrelated_public_host_before_contact(self):
        with patch.object(media, "build_opener") as opener:
            with self.assertRaisesRegex(ValueError, "approved HTTPS"):
                media.download_media("https://example.org/photo.png", media.IMAGE_LIMIT)
            opener.assert_not_called()
