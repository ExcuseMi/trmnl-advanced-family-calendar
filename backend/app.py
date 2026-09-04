import logging
import os

import aiohttp
from quart import Quart, Response, jsonify, request

from modules.utils.ip_whitelist import init_ip_whitelist, require_tiered_access
from modules.utils.ssrf_guard import UnsafeUrl, assert_safe_url

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
log = logging.getLogger(__name__)

app = Quart(__name__)

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


def _cors(resp: Response) -> Response:
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return resp


@app.route('/health')
async def health():
    return jsonify({'status': 'ok'})


# The Configuration Editor (tools/config-editor.html) and the demo calendars (demo/*.ics) are
# both plain static files in this repo now — served straight from GitHub (Pages for the
# editor, raw.githubusercontent.com for the .ics files; see README/demo-config.json) instead
# of through this backend. This backend exists ONLY for /ics-proxy below, which genuinely
# needs a server (fetching a third-party calendar host server-side, where CORS doesn't apply).

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
