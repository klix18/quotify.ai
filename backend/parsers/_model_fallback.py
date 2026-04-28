"""
Shared helpers for Gemini model fallback + upload retry across all parsers.

Each parser issues a single strict-JSON extraction call (Design 2). When
Google's Gemini tier is degraded (503 UNAVAILABLE, overloaded, resource
exhausted, etc.) we walk a chain of Gemini fallback models — if that
chain is empty or also fails, we fall through to a cross-provider
``openai_fallback`` callable the caller supplies.

Consumers of ``stream_with_fallback`` should already be idempotent on
repeated chunks (e.g. via a ``sent_final`` dedupe dict) since a retry
restarts the stream from scratch. Every parser in this package is
already written this way.
"""

import sys
import time
from typing import Any, Callable, Iterable, Iterator, List, Optional, Union

ModelSpec = Union[str, Iterable[str]]
# A callable that, when invoked with no args, yields replacement chunks —
# used as the cross-provider (OpenAI) fallback path after the Gemini model
# chain has been exhausted. Parsers capture their pdf_path, prompts, etc.
# in a closure and pass it in.
StreamFallbackFn = Callable[[], Iterator[Any]]
GenFallbackFn = Callable[[], Any]

# ── Diagnostic logging ──────────────────────────────────────────
# Prints one line per model attempt to stderr so you can see in the
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

# The Gemini fallback chain is intentionally EMPTY.
#
# History: we used to walk within the Gemini family (2.5-flash → 2.5-pro →
# 2.0-flash → 2.5-flash-lite) but on 2026-04-10 we observed that during a
# demand spike on 2.5-flash, 2.5-pro is hit by the same wave, 2.0-flash
# returns 404 "no longer available to new users" for this account, and the
# chain never reaches 2.5-flash-lite. Cross-provider (OpenAI) fallback is
# the only reliable recovery path, and it's handled via the
# ``openai_fallback`` parameter on ``stream_with_fallback`` /
# ``generate_with_fallback``.
#
# Callers should therefore pass this empty list as the fallback argument
# and supply an ``openai_fallback=`` closure. See ``_openai_fallback.py``.
DEFAULT_FALLBACKS: List[str] = []

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
    openai_fallback: Optional[StreamFallbackFn] = None,
) -> Iterator[Any]:
    """
    Call ``client.models.generate_content_stream`` on ``primary_model`` and
    transparently walk down ``fallback_model`` (a single model name or an
    ordered list of names) if the call fails before any chunks are yielded.

    If ``openai_fallback`` is provided, it's a zero-arg callable that
    returns an iterator of chunks — this is invoked as the *final* fallback
    after the entire Gemini chain has failed. The callable is responsible
    for producing chunks that match Gemini's shape (objects with a ``.text``
    attribute) so parser loops work unchanged. See ``_openai_fallback.py``.

    If the primary starts yielding chunks and *then* fails mid-stream, the
    error propagates — we don't splice a half-done primary stream onto a
    fresh fallback stream because that would double-count tokens in parser
    accumulators like ``full_text``. The 503 demand-spike case we actually
    care about always fails on the very first chunk, so this is fine.
    """
    chain = _build_chain(primary_model, fallback_model)
    has_openai = openai_fallback is not None
    _log(f"stream chain = {chain}  openai_fallback={has_openai}")
    last_exc: Exception | None = None
    gemini_exhausted = False

    for idx, model in enumerate(chain):
        is_last_gemini = idx == len(chain) - 1
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
                f"is_last_gemini={is_last_gemini} err={str(exc)[:200]}"
            )
            # If an OpenAI fallback is available, ANY Gemini failure
            # (retryable or not) should fall through to OpenAI — that's
            # the point of the cross-provider safety net. A 404 "model
            # no longer available" is specific to that Gemini model and
            # doesn't tell us anything about OpenAI.
            if has_openai:
                gemini_exhausted = True
                break
            # Otherwise (no openai fallback): only retry on retryable
            # errors, and raise when we hit the last chain entry or a
            # non-retryable error.
            if is_last_gemini or not retryable:
                raise
            continue

    # Also mark exhausted if we simply walked the whole chain without
    # finding a working model (e.g. chain=[] which is the new default).
    if not gemini_exhausted:
        gemini_exhausted = True

    if has_openai:
        _log(
            f"stream Gemini chain exhausted — falling through to OpenAI "
            f"(last_err={str(last_exc)[:160] if last_exc else 'none'})"
        )
        try:
            yield from openai_fallback()  # type: ignore[misc]
            return
        except Exception as openai_exc:
            _log(f"stream OpenAI fallback FAIL: err={str(openai_exc)[:200]}")
            raise

    # Shouldn't reach here (either we returned from Gemini success or
    # raised on Gemini failure), but just in case.
    if last_exc is not None:
        raise last_exc


def generate_with_fallback(
    client: Any,
    primary_model: str,
    fallback_model: ModelSpec,
    *,
    contents: Any,
    config: Any,
    openai_fallback: Optional[GenFallbackFn] = None,
) -> Any:
    """
    Non-streaming counterpart to ``stream_with_fallback`` — used for one-shot
    calls like classifiers and summary generators.

    If ``openai_fallback`` is provided, it's a zero-arg callable invoked as
    the final fallback after the Gemini chain fails. Its return value is
    passed back to the caller as-is, so the callable should return a value
    the caller already knows how to handle (typically a string).
    """
    chain = _build_chain(primary_model, fallback_model)
    has_openai = openai_fallback is not None
    _log(f"gen chain = {chain}  openai_fallback={has_openai}")
    last_exc: Exception | None = None

    for idx, model in enumerate(chain):
        is_last_gemini = idx == len(chain) - 1
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
                f"is_last_gemini={is_last_gemini} err={str(exc)[:200]}"
            )
            if has_openai:
                # Any Gemini failure → jump straight to OpenAI.
                break
            if is_last_gemini or not retryable:
                raise
            continue

    if has_openai:
        _log(
            f"gen Gemini chain exhausted — falling through to OpenAI "
            f"(last_err={str(last_exc)[:160] if last_exc else 'none'})"
        )
        try:
            return openai_fallback()  # type: ignore[misc]
        except Exception as openai_exc:
            _log(f"gen OpenAI fallback FAIL: err={str(openai_exc)[:200]}")
            raise

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
