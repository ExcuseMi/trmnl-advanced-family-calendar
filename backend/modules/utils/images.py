import io
import logging
import secrets

from PIL import Image, ImageOps

log = logging.getLogger(__name__)

MAX_DIMENSION = 512


class InvalidImage(Exception):
    pass


def new_image_id() -> str:
    return secrets.token_urlsafe(12)


def process_to_square(raw: bytes) -> tuple[bytes, int, int]:
    """Center-crop to 1:1 and downscale to MAX_DIMENSIONxMAX_DIMENSION (never upscale a
    smaller original — a small source photo just stays small, still square). Always
    re-encoded as JPEG regardless of source format: this is for a small badge/avatar
    circle, not archival storage, and a fixed output format keeps the serving side simple
    (one content-type, no per-image format branching). Raises InvalidImage for anything
    Pillow can't decode as an image, so the caller can turn that into a clean 4xx instead
    of a 500.
    """
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:
        raise InvalidImage(f'Not a readable image: {exc}') from exc

    # EXIF orientation (common on phone photos) — bake it into the pixels now, before
    # cropping/resizing, otherwise a portrait photo can end up sideways once the EXIF tag
    # itself is discarded by the re-encode below.
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB',):
        # Flatten transparency onto white rather than dropping it silently — a PNG with a
        # transparent background re-encoded straight to JPEG would otherwise turn black.
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode in ('RGBA', 'LA'):
            background.paste(img, mask=img.split()[-1])
        else:
            background.paste(img.convert('RGB'))
        img = background

    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))

    if side > MAX_DIMENSION:
        img = img.resize((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format='JPEG', quality=85)
    data = out.getvalue()
    return data, img.width, img.height
