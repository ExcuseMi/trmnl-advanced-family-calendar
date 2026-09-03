import logging
import os

import aiohttp
from quart import Quart, Response, jsonify, request

from modules.utils.db import delete_image, init_db, load_image, save_image
from modules.utils.images import InvalidImage, new_image_id, process_to_square
from modules.utils.ip_whitelist import init_ip_whitelist, require_tiered_access
from modules.utils.ssrf_guard import UnsafeUrl, assert_safe_url

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger(__name__)

app = Quart(__name__)

PUBLIC_BASE_URL = os.getenv('PUBLIC_BASE_URL', 'https://trmnl.bettens.dev/advanced-family-calendar').rstrip('/')
MAX_UPLOAD_BYTES = int(os.getenv('MAX_UPLOAD_BYTES', str(10 * 1024 * 1024)))  # 10 MB
MAX_PROXY_BYTES = int(os.getenv('MAX_PROXY_BYTES', str(15 * 1024 * 1024)))  # 15 MB
FETCH_TIMEOUT_SECONDS = int(os.getenv('FETCH_TIMEOUT_SECONDS', '15'))

_redis = None


def get_redis():
    return _redis


@app.before_serving
async def _startup():
    global _redis
    redis_url = os.getenv('REDIS_URL')
    if redis_url:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(redis_url, decode_responses=True)
        log.info('Redis connected')
    else:
        log.warning('REDIS_URL not set — rate limiting will be skipped')
    await init_ip_whitelist()
    await init_db()


def _cors(resp: Response) -> Response:
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return resp


@app.route('/health')
async def health():
    return jsonify({'status': 'ok'})


# ------------------------------------------------------------------ ICS proxy (CORS-free)
#
# The Configuration Editor (tools/config-editor.html) runs entirely in the user's browser,
# so testing a real ICS feed there hits CORS whenever the calendar host doesn't set
# Access-Control-Allow-Origin (most don't — Nextcloud/Google included). This endpoint
# fetches the feed server-side (where CORS doesn't apply) and hands the raw text back with
# permissive CORS headers, so the editor's own existing ICS-parsing/preview code (it
# already knows how to render a pasted .ics file) can consume it exactly the same way,
# for every calendar in the config in one pass instead of a manual copy-paste per calendar.

@app.route('/ics-proxy', methods=['GET', 'OPTIONS'])
@require_tiered_access(get_redis, 'ics-proxy')
async def ics_proxy():
    if request.method == 'OPTIONS':
        return _cors(Response(''))

    url = request.args.get('url', '').strip()
    if not url:
        return _cors(jsonify({'error': 'Missing url parameter'})), 400

    try:
        text = await _fetch_safely(url)
    except UnsafeUrl as exc:
        return _cors(jsonify({'error': str(exc)})), 400
    except aiohttp.ClientError as exc:
        return _cors(jsonify({'error': f'Fetch failed: {exc}'})), 502
    except TimeoutError:
        return _cors(jsonify({'error': 'Fetch timed out'})), 504

    resp = Response(text, content_type='text/calendar; charset=utf-8')
    return _cors(resp)


async def _fetch_safely(url: str, max_redirects: int = 5) -> str:
    """GET url, re-validating (SSRF guard) after every redirect hop instead of trusting
    the very first URL alone — a redirect is exactly how a naive "check the URL once"
    guard gets bypassed. Raises UnsafeUrl/aiohttp.ClientError/TimeoutError on failure.
    """
    current = url
    async with aiohttp.ClientSession() as session:
        for _ in range(max_redirects + 1):
            await assert_safe_url(current)
            async with session.get(
                current, allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT_SECONDS),
            ) as resp:
                if resp.status in (301, 302, 303, 307, 308):
                    location = resp.headers.get('Location')
                    if not location:
                        raise aiohttp.ClientError('Redirect with no Location header')
                    current = str(resp.url.join(location) if not location.startswith('http') else location)
                    continue
                resp.raise_for_status()
                body = await resp.content.read(MAX_PROXY_BYTES + 1)
                if len(body) > MAX_PROXY_BYTES:
                    raise aiohttp.ClientError(f'Response exceeds {MAX_PROXY_BYTES} bytes')
                return body.decode('utf-8', errors='replace')
    raise aiohttp.ClientError('Too many redirects')


# ------------------------------------------------------------------------------- images
#
# Person/category photos: TRMNL's own render pipeline fetches images.people[].image /
# categories[].icon server-side, and several public image hosts (imgur confirmed) block
# that kind of non-browser hotlinking outright. Self-hosting here sidesteps it entirely —
# this backend fetching its own stored bytes is never rate-limited/blocked by anyone but
# us. Every upload is normalized to a square JPEG capped at 512x512 (see
# modules/utils/images.py) before it's stored, so there's no unbounded-size content sitting
# in Postgres and every stored image is already exactly the shape shared.liquid expects
# for a badge-circle photo.

@app.route('/images', methods=['POST', 'OPTIONS'])
@require_tiered_access(get_redis, 'images-upload')
async def upload_image():
    if request.method == 'OPTIONS':
        return _cors(Response(''))

    files = await request.files
    upload = files.get('file')
    if upload is None:
        return _cors(jsonify({'error': 'Missing "file" in multipart form data'})), 400

    raw = upload.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        return _cors(jsonify({'error': f'File exceeds {MAX_UPLOAD_BYTES} bytes'})), 400

    try:
        data, width, height = process_to_square(raw)
    except InvalidImage as exc:
        return _cors(jsonify({'error': str(exc)})), 400

    image_id = new_image_id()
    await save_image(image_id, 'image/jpeg', data, width, height)

    return _cors(jsonify({
        'id': image_id,
        'url': f'{PUBLIC_BASE_URL}/images/{image_id}',
        'width': width,
        'height': height,
    }))


@app.route('/images/<image_id>', methods=['GET'])
async def serve_image(image_id):
    # Deliberately NOT behind require_tiered_access — this is the URL that ends up in
    # people[].image/categories[].icon, fetched by TRMNL's render pipeline on every
    # refresh. Gating it the same as the upload endpoint would just recreate the exact
    # hotlink-blocking problem this backend exists to solve.
    row = await load_image(image_id)
    if row is None:
        return _cors(jsonify({'error': 'Not found'})), 404
    resp = Response(row['data'], content_type=row['content_type'])
    resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return _cors(resp)


@app.route('/images/<image_id>', methods=['DELETE', 'OPTIONS'])
@require_tiered_access(get_redis, 'images-delete')
async def remove_image(image_id):
    if request.method == 'OPTIONS':
        return _cors(Response(''))
    deleted = await delete_image(image_id)
    if not deleted:
        return _cors(jsonify({'error': 'Not found'})), 404
    return _cors(jsonify({'ok': True}))


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
