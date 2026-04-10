"""
Shared helper for Gemini model fallback across all parsers.

All parsers use a 2-pass pipeline:
  Pass 1 = fast draft  (primary: gemini-2.5-flash-lite)
  Pass 2 = strict JSON (primary: gemini-2.5-flash)

When Google's Gemini tier is degraded (503 UNAVAILABLE, overloaded, resource
exhausted, etc.) we transparently walk down a *chain* of fallback models so
uploads don't dead-end in the UI. We try multiple models because during a
broad Gemini outage, a single fallback may also be down.

Fallback policy (per the product decision):
  * Pass 1 (quick draft):  lean LIGHTER — prefer cheaper, older, or smaller
                           tiers. We're OK with losing a bit of quality on
                           the draft because Pass 2 will overwrite it, and
                           lighter tiers tend to live on separate capacity
                           pools that stay healthy during flash-lite spikes.

  * Pass 2 (strict JSON):  lean MORE CAPABLE — prefer models with better
                           JSON schema compliance. We only pay the extra
                           cost when flash is actively failing, and pro
                           tends to have better availability during flash
                           demand spikes.

Consumers of ``stream_with_fallback`` should already be idempotent on repeated
chunks (e.g. via a ``sent_draft``/``sent_final`` dedupe dict) since a retry
restarts the stream from scratch. Every parser in this package is already
written this way, so callers can drop this helper in directly.
"""

import logging
import sys
import time
from typing import Any, Iterable, Iterator, List, Union

ModelSpec = Union[str, Iterable[str]]

# ── Diagnostic logging ──────────────────────────────────────────
# Prints one line per model attempt to stdout so you can see in the
# backend logs exactly which model is being called and whether the
# fallback chain actually ran. When the chain silently succeeds on
# the primary there will be exactly ONE line per request. When it
# falls back there will be one line per attempted model.
#
# We deliberately `print(..., flush=True)` instead of using the
# `logging` module so the output shows up even if the FastAPI server
# hasn't configured log handlers for this module's namespace.

_FALLBACK_VERSION = "v2-chain"


def _log(msg: str) -> None:
    print(f"[fallback:{_FALLBACK_VERSION}] {msg}", flush=True, file=sys.stderr)


# Module-load marker — prints once at server startup so you can tell
# from the logs that the new fallback helper was imported and is live.
print(
    f"[fallback:{_FALLBACK_VERSION}] module loaded (chain fallback active)",
    flush=True,
    file=sys.stderr,
)

# Full fallback chains. Order matters — we walk left-to-right, hopping to
# the next model whenever the current one returns a transient error. Each
# chain touches several distinct capacity pools (different model families,
# different generations) so that a broad outage on one tier doesn't take
# the whole pipeline down.
DEFAULT_QUICK_FALLBACKS: List[str] = [
    "gemini-2.0-flash-lite",  # lighter, prior-gen, separate pool
    "gemini-2.0-flash",        # prior-gen flash, still relatively light
    "gemini-2.5-flash",        # last resort: the Pass 2 primary
]

DEFAULT_FINAL_FALLBACKS: List[str] = [
    "gemini-2.5-pro",          # more capable, different tier
    "gemini-2.0-flash",        # prior-gen flash (good schema compliance)
    "gemini-2.5-flash-lite",   # last resort: the Pass 1 primary
]

# Backwards-compatible singular aliases — kept so older call sites that
# imported ``DEFAULT_QUICK_FALLBACK`` (singular) still work.
DEFAULT_QUICK_FALLBACK: str = DEFAULT_QUICK_FALLBACKS[0]
DEFAULT_FINAL_FALLBACK: str = DEFAULT_FINAL_FALLBACKS[0]

# Substrings (lower-cased) that indicate a transient / retryable error.
# We match on the stringified exception because google-genai raises several
# different exception classes (ServerError, ClientError, ApiError, plain
# Exception wrapping a dict) and they don't share a clean base class we can
# rely on. Matching the message is ugly but robust.
_RETRYABLE_SIGNALS = (
    "503",
    "500",
    "502",
    "504",
    "unavailable",
    "overloaded",
    "resource_exhausted",
    "resourceexhausted",
    "resource exhausted",
    "quota",
    "rate limit",
    "rate_limit",
    "deadline",
    "internal error",
    "temporarily",
    "try again",
    "high demand",
)


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(sig in msg for sig in _RETRYABLE_SIGNALS)


def _build_chain(primary: str, fallback: ModelSpec) -> List[str]:
    """
    Turn ``(primary, fallback)`` into a deduped ordered list of models to try.

    ``fallback`` may be a single string (legacy API) or any iterable of strings
    (preferred). Falsy or duplicate entries are skipped — we never try the
    same model twice in one call.
    """
    chain: List[str] = [primary]

    if fallback is None:
        return chain

    if isinstance(fallback, str):
        candidates: Iterable[str] = [fallback]
    else:
        candidates = fallback

    for model in candidates:
        if not model:
            continue
        if model in chain:
            continue
        chain.append(model)

    return chain


def stream_with_fallback(
    client: Any,
    primary_model: str,
    fallback_model: ModelSpec,
    *,
    contents: Any,
    config: Any,
) -> Iterator[Any]:
    """
    Call ``client.models.generate_content_stream`` on ``primary_model`` and
    transparently walk down ``fallback_model`` (a single model name or an
    ordered list of names) if the call fails with a transient error before
    any chunks are yielded.

    Non-retryable errors (auth failures, bad input, schema errors, etc.) are
    re-raised immediately without attempting any fallback.

    If the primary starts yielding chunks and *then* fails mid-stream, the
    error propagates — we don't try to splice a half-done primary stream onto
    a fresh fallback stream because that would double-count tokens in
    accumulators like ``full_text``. The 503 demand-spike case we actually
    care about always fails on the very first chunk, so this is fine.
    """
    chain = _build_chain(primary_model, fallback_model)
    _log(f"stream chain = {chain}")
    last_exc: Exception | None = None

    for idx, model in enumerate(chain):
        is_last = idx == len(chain) - 1
        try:
            _log(f"stream attempt {idx + 1}/{len(chain)}: model={model}")
            stream = client.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )

            # Pull the first chunk eagerly so a 503 on the initial request
            # surfaces *before* we commit to yielding from this model.
            iterator = iter(stream)
            try:
                first_chunk = next(iterator)
            except StopIteration:
                # Empty stream — treat as a successful (but empty) response.
                _log(f"stream OK (empty): model={model}")
                return

            _log(f"stream OK (committed): model={model}")
            yield first_chunk
            for chunk in iterator:
                yield chunk
            return

        except Exception as exc:
            last_exc = exc
            retryable = _is_retryable(exc)
            _log(
                f"stream FAIL: model={model} retryable={retryable} "
                f"is_last={is_last} err={str(exc)[:200]}"
            )
            if is_last or not retryable:
                raise
            # Otherwise: swallow and try the next model in the chain.
            continue

    # Shouldn't reach here, but just in case.
    if last_exc is not None:
        raise last_exc


def generate_with_fallback(
    client: Any,
    primary_model: str,
    fallback_model: ModelSpec,
    *,
    contents: Any,
    config: Any,
) -> Any:
    """
    Non-streaming counterpart to ``stream_with_fallback`` — used for one-shot
    calls like classifiers and summary generators. Same retry semantics,
    minus the stream plumbing.
    """
    chain = _build_chain(primary_model, fallback_model)
    _log(f"gen chain = {chain}")
    last_exc: Exception | None = None

    for idx, model in enumerate(chain):
        is_last = idx == len(chain) - 1
        try:
            _log(f"gen attempt {idx + 1}/{len(chain)}: model={model}")
            resp = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            _log(f"gen OK: model={model}")
            return resp
        except Exception as exc:
            last_exc = exc
            retryable = _is_retryable(exc)
            _log(
                f"gen FAIL: model={model} retryable={retryable} "
                f"is_last={is_last} err={str(exc)[:200]}"
            )
            if is_last or not retryable:
                raise
            continue

    if last_exc is not None:
        raise last_exc


def upload_with_retry(
    client: Any,
    *,
    file: Any,
    config: Any,
    max_attempts: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 16.0,
) -> Any:
    """
    Retry ``client.files.upload(...)`` with exponential backoff on transient
    errors (503 UNAVAILABLE, 5xx, overloaded, quota, "high demand", etc.).

    Gemini's files API is a single endpoint — there is no "fallback model" to
    hop to — so the only correct response to a transient upload failure is to
    wait a bit and try again. We walk:

        attempt 1 → 0s
        attempt 2 → base_delay
        attempt 3 → base_delay * 2
        attempt 4 → base_delay * 4
        attempt 5 → base_delay * 8 (capped at max_delay)

    Non-retryable errors (bad mime type, auth failure, file-too-large, etc.)
    are re-raised immediately without waiting.

    This is intentionally a separate helper from ``stream_with_fallback`` /
    ``generate_with_fallback`` because the retry shape is different: there's
    no model chain, and we want actual sleep-backoff rather than just hopping
    to the next entry in a list.
    """
    _log(f"upload start: file={file}  max_attempts={max_attempts}")
    last_exc: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        is_last = attempt == max_attempts
        try:
            _log(f"upload attempt {attempt}/{max_attempts}")
            result = client.files.upload(file=file, config=config)
            name = getattr(result, "name", "?")
            _log(f"upload OK: name={name} (attempt {attempt})")
            return result
        except Exception as exc:
            last_exc = exc
            retryable = _is_retryable(exc)
            _log(
                f"upload FAIL: attempt={attempt}/{max_attempts} "
                f"retryable={retryable} is_last={is_last} "
                f"err={str(exc)[:200]}"
            )
            if is_last or not retryable:
                raise

            # Exponential backoff, capped.
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            _log(f"upload sleeping {delay:.1f}s before retry")
            time.sleep(delay)
            continue

    if last_exc is not None:
        raise last_exc
