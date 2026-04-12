"""
Persistent Chromium browser manager.

Keeps a single Chromium instance alive for the lifetime of the server.
First PDF generation pays the ~2s startup cost; every subsequent one
reuses the running browser and finishes near-instantly.
"""

from playwright.async_api import async_playwright, Browser

_playwright = None
_browser: Browser | None = None


async def get_browser() -> Browser:
    """Return the shared Chromium browser, launching it on first call."""
    global _playwright, _browser

    if _browser is None or not _browser.is_connected():
        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(
            args=[
                # Disable subpixel font positioning — prevents Chromium's
                # PDF text encoder from accumulating fractional-pixel
                # rounding errors that produce mid-word gaps.
                "--disable-font-subpixel-positioning",
                # Disable LCD text (subpixel) rendering — PDF doesn't
                # have subpixels, so this avoids width miscalculations.
                "--disable-lcd-text",
                # Use no hinting — lets the font's own metrics control
                # glyph advances without OS-level adjustments.
                "--font-render-hinting=none",
            ]
        )

    return _browser


async def close_browser():
    """Gracefully shut down the browser (call on server shutdown)."""
    global _playwright, _browser

    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright is not None:
        await _playwright.stop()
        _playwright = None
