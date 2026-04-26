"""
Lightweight helpers to log AI API usage (tokens + estimated cost)
after each OpenAI or Gemini call.

Cost estimates are approximate and based on published pricing.
They won't match invoices exactly but give a good picture of spend.
"""

import asyncio
import logging
from core.database import log_api_usage

_log = logging.getLogger("usage_tracker")

# ── Approximate per-token prices (USD) ──────────────────────────────
# Updated for models used by this project. Prices per 1M tokens.

_PRICES = {
    # OpenAI
    "gpt-4o":           {"input": 2.50,  "output": 10.00},
    "gpt-4o-mini":      {"input": 0.15,  "output": 0.60},
    # Google Gemini
    "gemini-2.5-flash":      {"input": 0.15, "output": 0.60},
    "gemini-2.5-flash-lite": {"input": 0.075, "output": 0.30},
    "gemini-2.0-flash":      {"input": 0.10, "output": 0.40},
    "gemini-1.5-flash":      {"input": 0.075, "output": 0.30},
}

_DEFAULT_PRICE = {"input": 1.00, "output": 3.00}  # conservative fallback


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for a single API call."""
    prices = _PRICES.get(model, _DEFAULT_PRICE)
    return (input_tokens * prices["input"] + output_tokens * prices["output"]) / 1_000_000


def track_openai_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    call_type: str = "chat",
) -> None:
    """Fire-and-forget: log OpenAI usage to the database."""
    cost = _estimate_cost(model, input_tokens, output_tokens)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(log_api_usage(
            provider="openai",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=cost,
            call_type=call_type,
        ))
    except RuntimeError:
        _log.debug("No event loop — skipping usage log")


def track_gemini_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    call_type: str = "generation",
) -> None:
    """Fire-and-forget: log Gemini usage to the database."""
    cost = _estimate_cost(model, input_tokens, output_tokens)
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(log_api_usage(
            provider="gemini",
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=cost,
            call_type=call_type,
        ))
    except RuntimeError:
        _log.debug("No event loop — skipping usage log")


def track_gemini_response(response, model: str, call_type: str = "generation") -> None:
    """Extract usage_metadata from a Gemini response and log it."""
    try:
        meta = getattr(response, "usage_metadata", None)
        if meta is None:
            return
        input_t = getattr(meta, "prompt_token_count", 0) or 0
        output_t = getattr(meta, "candidates_token_count", 0) or 0
        if input_t or output_t:
            track_gemini_usage(model, input_t, output_t, call_type)
    except Exception:
        _log.debug("Failed to extract Gemini usage metadata", exc_info=True)
