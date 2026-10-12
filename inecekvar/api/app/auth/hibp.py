import hashlib
import hmac

import httpx
import structlog

from app.core.settings import Settings

HIBP_BASE_URL = "https://api.pwnedpasswords.com"


class HibpRangeClient:
    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def is_breached(self, password: str) -> bool:
        if not self.settings.hibp_enabled:
            return False
        digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
        try:
            async with httpx.AsyncClient(
                transport=self.transport,
                follow_redirects=False,
                timeout=self.settings.hibp_timeout_seconds,
            ) as client:
                response = await client.get(
                    HIBP_BASE_URL + "/range/" + digest[:5], headers={"Add-Padding": "true"}
                )
        except httpx.RequestError:
            structlog.get_logger().warning("hibp.unavailable")
            return False
        if response.status_code != 200:
            structlog.get_logger().warning("hibp.unavailable")
            return False
        found = False
        for line in response.text.splitlines():
            suffix, separator, count = line.partition(":")
            matches = hmac.compare_digest(suffix.upper().encode(), digest[5:].encode())
            count = count.strip()
            if separator and count.isascii() and count.isdecimal() and count.strip("0") and matches:
                found = True
        return found
