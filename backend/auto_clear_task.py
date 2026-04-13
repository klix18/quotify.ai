"""
Background task that periodically checks the PDF auto-clear setting
and deletes all PDFs if the configured interval has elapsed.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from database import get_setting, set_setting, delete_all_pdfs

_log = logging.getLogger("auto_clear")

# How often to check (every hour)
CHECK_INTERVAL_SECONDS = 3600

# Map setting values to timedelta thresholds
_THRESHOLDS = {
    "weekly":  timedelta(days=7),
    "monthly": timedelta(days=30),
    "6months": timedelta(days=180),
    "yearly":  timedelta(days=365),
}


async def _run_cycle():
    """Single check-and-clear cycle."""
    try:
        schedule = await get_setting("pdf_auto_clear", "never")
        if schedule == "never" or schedule not in _THRESHOLDS:
            return

        threshold = _THRESHOLDS[schedule]
        last_cleared_str = await get_setting("pdf_auto_clear_last", "")

        if last_cleared_str:
            last_cleared = datetime.fromisoformat(last_cleared_str)
        else:
            # First time — set the baseline to now (don't clear on first run)
            await set_setting("pdf_auto_clear_last", datetime.now(timezone.utc).isoformat())
            return

        elapsed = datetime.now(timezone.utc) - last_cleared
        if elapsed >= threshold:
            count = await delete_all_pdfs()
            await set_setting("pdf_auto_clear_last", datetime.now(timezone.utc).isoformat())
            _log.info(f"Auto-clear ({schedule}): deleted {count} PDFs")
    except Exception:
        _log.exception("Auto-clear cycle failed")


async def start_auto_clear_loop():
    """Long-running background loop — call once at startup."""
    _log.info("Auto-clear background task started")
    while True:
        await _run_cycle()
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
