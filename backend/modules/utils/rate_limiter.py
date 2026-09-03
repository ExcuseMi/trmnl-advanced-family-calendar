import logging

log = logging.getLogger(__name__)


async def is_rate_limited(redis, key: str, window: int, limit: int) -> bool:
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window)
        return count > limit
    except Exception as exc:
        log.warning('Redis rate limiter unavailable (%s): %s', key, exc)
        return False
