import asyncio
import logging
import os
from functools import wraps

import aiohttp
from quart import jsonify, request

TRMNL_IPS_API = 'https://trmnl.com/api/ips'
ACCESS_MODE = os.getenv('ACCESS_MODE', 'whitelist_only')
IP_REFRESH_HOURS = int(os.getenv('IP_REFRESH_HOURS', '24'))
LOCALHOST_IPS = {'127.0.0.1', '::1'}

log = logging.getLogger(__name__)
_ips: set[str] = set(LOCALHOST_IPS)
_lock = asyncio.Lock()


async def _fetch_ips() -> set[str]:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(TRMNL_IPS_API, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                resp.raise_for_status()
                data = await resp.json()
                addrs = data.get('data', {})
                ips = set(addrs.get('ipv4', []) + addrs.get('ipv6', [])) | LOCALHOST_IPS
                log.info('Loaded %d TRMNL IPs', len(ips))
                return ips
    except Exception as exc:
        log.warning('Failed to fetch TRMNL IPs: %s', exc)
        return set()


async def _refresh_loop():
    while True:
        await asyncio.sleep(IP_REFRESH_HOURS * 3600)
        fresh = await _fetch_ips()
        if fresh:
            async with _lock:
                global _ips
                _ips = fresh


async def init_ip_whitelist():
    global _ips
    if ACCESS_MODE == 'open':
        log.info('Access mode: open (no IP restrictions)')
        return
    fresh = await _fetch_ips()
    if fresh:
        async with _lock:
            _ips = fresh
    asyncio.create_task(_refresh_loop())
    log.info('Access mode: %s — IP list refresh every %dh', ACCESS_MODE, IP_REFRESH_HOURS)


def _client_ip() -> str:
    for header in ('CF-Connecting-IP', 'X-Forwarded-For', 'X-Real-IP'):
        value = request.headers.get(header)
        if value:
            return value.split(',')[0].strip()
    return request.remote_addr


async def check_access(redis, prefix: str):
    """Returns None if allowed, 'blocked' if denied, 'rate_limited' if throttled."""
    if ACCESS_MODE == 'open':
        return None

    ip = _client_ip()
    async with _lock:
        is_trmnl = ip in _ips

    if is_trmnl:
        return None

    if ACCESS_MODE == 'whitelist_only':
        log.warning('Blocked %s → %s', ip, prefix)
        return 'blocked'

    # rate_limited mode
    window = int(os.getenv('PUBLIC_RATE_LIMIT_WINDOW_SECONDS', '300'))
    if redis is not None:
        from modules.utils.rate_limiter import is_rate_limited
        if await is_rate_limited(redis, f'ratelimit:{prefix}:{ip}', window):
            log.info('Rate limited: %s:%s', prefix, ip)
            return 'rate_limited'
    else:
        log.warning('Rate limiting skipped — Redis unavailable for %s:%s', prefix, ip)

    return None


def require_tiered_access(redis_getter, prefix: str):
    def decorator(f):
        @wraps(f)
        async def decorated(*args, **kwargs):
            # CORS preflight carries no payload and must succeed unconditionally, or the
            # browser never even attempts the real request that follows it — gating this
            # the same as the real method would make rate-limited/blocked callers fail
            # before check_access ever saw the request that actually matters.
            if request.method == 'OPTIONS':
                return await f(*args, **kwargs)
            result = await check_access(redis_getter(), prefix)
            if result == 'blocked':
                return jsonify({'error': 'Access denied'}), 403
            if result == 'rate_limited':
                return jsonify({'error': 'Rate limit exceeded'}), 429
            return await f(*args, **kwargs)
        return decorated
    return decorator
