import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urlparse

log = logging.getLogger(__name__)


class UnsafeUrl(Exception):
    pass


async def assert_safe_url(url: str) -> None:
    """Raises UnsafeUrl for anything that isn't a plain public http(s) URL. This endpoint
    fetches whatever URL a caller hands it and returns the response — a textbook SSRF
    vector otherwise, and this box also runs several *other* internal-only services on
    its own LAN (see the Caddy config) that a bare "fetch this for me" proxy could
    otherwise be turned into a port-scanner/access route for.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise UnsafeUrl('Only http:// and https:// URLs are allowed')
    if not parsed.hostname:
        raise UnsafeUrl('URL has no hostname')

    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise UnsafeUrl(f'Could not resolve hostname: {exc}') from exc

    for info in infos:
        addr = info[4][0]
        ip = ipaddress.ip_address(addr)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise UnsafeUrl(f'Refusing to fetch a non-public address ({addr})')
