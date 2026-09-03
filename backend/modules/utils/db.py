import asyncio
import logging
import os

import asyncpg

log = logging.getLogger(__name__)

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/postgres')

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        await init_db()
    return _pool


async def init_db() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    # Postgres might still be booting when this container starts — retry rather than
    # crash-looping on the very first connection attempt.
    for attempt in range(10):
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL)
            async with _pool.acquire() as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS images (
                        id TEXT PRIMARY KEY,
                        content_type TEXT NOT NULL,
                        data BYTEA NOT NULL,
                        width INTEGER NOT NULL,
                        height INTEGER NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                """)
            log.info('PostgreSQL connection pool initialized')
            return _pool
        except Exception as exc:
            if attempt == 9:
                log.error('Failed to connect to PostgreSQL after 10 attempts: %s', exc)
                raise
            log.warning('PostgreSQL not ready, retrying in 2s... (%d/10)', attempt + 1)
            await asyncio.sleep(2)
    return _pool


async def save_image(image_id: str, content_type: str, data: bytes, width: int, height: int) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO images (id, content_type, data, width, height)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
                content_type = EXCLUDED.content_type,
                data = EXCLUDED.data,
                width = EXCLUDED.width,
                height = EXCLUDED.height,
                created_at = now()
            """,
            image_id, content_type, data, width, height,
        )


async def load_image(image_id: str) -> asyncpg.Record | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            'SELECT content_type, data FROM images WHERE id = $1', image_id,
        )


async def delete_image(image_id: str) -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute('DELETE FROM images WHERE id = $1', image_id)
        return result != 'DELETE 0'
