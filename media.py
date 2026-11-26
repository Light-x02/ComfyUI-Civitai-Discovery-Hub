"""Download Civitai media and decode one RGB frame for a ComfyUI IMAGE."""

import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import av
import numpy as np
import torch
from PIL import Image, ImageOps, UnidentifiedImageError


IMAGE_LIMIT = 64 * 1024 * 1024
VIDEO_LIMIT = 128 * 1024 * 1024
WORKFLOW_PREFIX = 4 * 1024 * 1024
MAX_PIXELS = 32_000_000
MEDIA_HOSTS = {"image.civitai.com", "image.civitai.red", "image.civitai.green", "image.civitai.work"}


def _check_url(url):
    if not isinstance(url, str) or not url or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise ValueError("Missing or invalid Civitai media URL.")
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc.lower().removesuffix(":443") not in MEDIA_HOSTS:
        raise ValueError("Media must use an approved HTTPS Civitai image host.")


class _MediaRedirects(HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_media(url, limit, *, prefix=False):
    """Return a rewound, caller-owned stream which spills large responses to disk."""
    _check_url(url)
    headers = {"User-Agent": "ComfyUI-Civitai-Discovery-Hub", "Accept-Encoding": "identity"}
    if prefix:
        headers["Range"] = f"bytes=0-{limit - 1}"
    request = Request(url, headers=headers)
    deadline = time.monotonic() + 60
    stream = tempfile.SpooledTemporaryFile(max_size=2 * 1024 * 1024)
    try:
        with build_opener(_MediaRedirects()).open(request, timeout=15) as response:
            length = response.headers.get("Content-Length", "")
            if not prefix and length.isdecimal() and int(length) > limit:
                raise ValueError(f"Civitai media exceeds the {limit // 1048576} MiB download limit.")
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Civitai media download timed out.")
                remaining = limit - stream.tell()
                if prefix and not remaining:
                    break
                chunk = response.read1(min(256 * 1024, remaining + (0 if prefix else 1)))
                if not chunk:
                    break
                if len(chunk) > remaining:
                    raise ValueError(f"Civitai media exceeds the {limit // 1048576} MiB download limit.")
                stream.write(chunk)
        stream.seek(0)
        return stream
    except BaseException:
        stream.close()
        raise


def _check_dimensions(width, height):
    if width * height > MAX_PIXELS:
        raise ValueError("Civitai media exceeds the 32 megapixel limit.")


def _first_video_frame(stream):
    # Restrict the demuxer to self-contained MP4/WebM, including during probing.
    options = {"format_whitelist": "mov,matroska,webm", "protocol_whitelist": "", "enable_drefs": "0"}
    with av.open(stream, mode="r", options=options) as video:
        if not video.streams.video:
            raise ValueError("The Civitai file has no video track.")
        track = video.streams.video[0]
        _check_dimensions(track.width, track.height)
        track.codec_context.options = {**track.codec_context.options, "max_pixels": str(MAX_PIXELS)}
        frame = next(video.decode(track), None)
        if frame is None:
            raise ValueError("The Civitai video contains no readable frame.")
        _check_dimensions(frame.width, frame.height)
        return frame.to_ndarray(format="rgb24")


def _image_pixels(source):
    _check_dimensions(*source.size)
    image = source
    if source.getexif().get(274) in range(2, 9):
        image = ImageOps.exif_transpose(source)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return np.asarray(image)


def image_tensor(url, *, video=False):
    with download_media(url, VIDEO_LIMIT if video else IMAGE_LIMIT) as stream:
        if video:
            pixels = _first_video_frame(stream)
        else:
            try:
                with Image.open(stream) as source:
                    pixels = _image_pixels(source)
            except UnidentifiedImageError as exc:
                raise ValueError("Civitai returned an unreadable image.") from exc
        pixels = np.asarray(pixels, dtype=np.float32)
        pixels /= 255.0
        return torch.from_numpy(pixels).unsqueeze(0)
