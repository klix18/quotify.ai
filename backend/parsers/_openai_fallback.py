"""
OpenAI cross-provider fallback for the parser pipeline.

When Gemini's entire model chain fails (503 demand spikes, model retired,
etc.), parsers fall through to this module which uses OpenAI's Responses
API to complete the same pass. The helper yields chunks shaped like
Gemini stream chunks (objects with ``.text``) so existing parser loops
can consume them unchanged.

Fallback model chain for parsers (per product decision — see
``.auto-memory/feedback_fallback_models.md``):
  * Pass 1 (quick draft):  gpt-4o-mini → gpt-4o
  * Pass 2 (strict JSON):  gpt-4o-mini → gpt-4o

We intentionally lean "heavier" (GPT-4o tier) on the fallback path because
the fallback has to be reliable for a customer-facing tool — we only pay
the extra cost when Gemini is actively failing.

Why the Responses API: it natively supports PDF input via ``input_file``
(uploaded to OpenAI files API with ``purpose="user_data"``), which is the
closest analogue to Gemini's ``client.files.upload`` + reference-by-file
flow. We don't need to base64-inline the PDF or split it.
"""

import os
import sys
from pathlib import Path
from typing import Any, Iterator, List, Optional

from openai import OpenAI

# ── Diagnostic logging ──────────────────────────────────────────
_OPENAI_FALLBACK_VERSION = "v1-openai-fallback"


def _log(msg: str) -> None:
    print(
        f"[openai-fallback:{_OPENAI_FALLBACK_VERSION}] {msg}",
        flush=True,
        file=sys.stderr,
    )


# Module-load marker so you can tell from the backend logs that the
# OpenAI fallback helper was imported successfully.
print(
    f"[openai-fallback:{_OPENAI_FALLBACK_VERSION}] module loaded",
    flush=True,
    file=sys.stderr,
)


# Default OpenAI fallback chain for parsers — walked left-to-right on
# transient errors. Keep both entries; during a broad degradation we want
# to try the cheaper model first and only escalate to the premium model
# if the cheap one also fails.
PARSER_FALLBACK_MODELS: List[str] = [
    "gpt-4o-mini",
    "gpt-4o",
]


class _Chunk:
    """
    Shape-compatible with Gemini stream chunks (has a ``.text`` attribute).

    Parser loops iterate stream chunks and pull ``chunk.text or ""`` to
    accumulate output — we match that contract exactly so the OpenAI
    fallback is a drop-in replacement with no downstream changes.
    """

    __slots__ = ("text",)

    def __init__(self, text: str):
        self.text = text


# Transient error signals — mirrors _model_fallback._RETRYABLE_SIGNALS but
# re-declared here so this module has no circular dep on the Gemini helper.
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
    return any(sig in str(exc).lower() for sig in _RETRYABLE_SIGNALS)


_client_cache: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    """Lazy-init a module-level OpenAI client so we don't re-create it per request."""
    global _client_cache
    if _client_cache is None:
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set — cannot use OpenAI fallback path. "
                "Set OPENAI_API_KEY in backend/.env."
            )
        _client_cache = OpenAI(api_key=api_key)
    return _client_cache


def _upload_pdf(client: OpenAI, pdf_path: Path) -> str:
    """Upload a PDF to OpenAI files API with user_data purpose; returns file_id."""
    _log(f"uploading PDF: {pdf_path}")
    with open(pdf_path, "rb") as f:
        result = client.files.create(file=f, purpose="user_data")
    file_id = result.id
    _log(f"uploaded: file_id={file_id}")
    return file_id


def stream_openai_extraction(
    pdf_path: Path,
    system_instruction: str,
    user_prompt: str,
    *,
    models: Optional[List[str]] = None,
) -> Iterator[Any]:
    """
    Stream a PDF extraction pass using OpenAI's Responses API.

    Yields ``_Chunk`` objects (each with a ``.text`` str delta) so the
    caller — a parser's existing stream loop — can accumulate output
    the same way it does for Gemini chunks.

    Walks the ``models`` chain (default: gpt-4o-mini → gpt-4o) and
    re-attempts on transient errors. Non-retryable errors (auth, quota
    exceeded, invalid input) raise immediately.

    This is intended as the *last-resort* fallback after the full Gemini
    chain has failed. Because it re-uploads the PDF to OpenAI, it's
    slower than the Gemini path — we accept that cost in exchange for
    the reliability win.
    """
    if models is None:
        models = PARSER_FALLBACK_MODELS

    client = _get_client()

    # Upload once and reuse across model attempts in the chain.
    try:
        file_id = _upload_pdf(client, pdf_path)
    except Exception as exc:
        _log(f"PDF upload FAIL: err={str(exc)[:200]}")
        raise

    _log(f"stream chain = {models}")
    last_exc: Optional[Exception] = None

    for idx, model in enumerate(models):
        is_last = idx == len(models) - 1
        try:
            _log(f"stream attempt {idx + 1}/{len(models)}: model={model}")
            stream = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "system",
                        "content": system_instruction,
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": user_prompt},
                            {"type": "input_file", "file_id": file_id},
                        ],
                    },
                ],
                stream=True,
            )

            committed = False
            for event in stream:
                etype = getattr(event, "type", "")
                if etype == "response.output_text.delta":
                    delta = getattr(event, "delta", "") or ""
                    if delta:
                        if not committed:
                            _log(f"stream OK (committed): model={model}")
                            committed = True
                        yield _Chunk(delta)
                elif etype == "response.error":
                    err = getattr(event, "error", "unknown error")
                    raise RuntimeError(f"OpenAI stream error: {err}")
                # Other events (created, in_progress, completed, done, etc.)
                # are metadata-only and can be ignored.

            if not committed:
                _log(f"stream OK (empty): model={model}")
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
            continue

    if last_exc is not None:
        raise last_exc


def generate_openai_extraction(
    pdf_path: Optional[Path],
    system_instruction: str,
    user_prompt: str,
    *,
    models: Optional[List[str]] = None,
) -> str:
    """
    Non-streaming counterpart — returns the full output_text as a single string.

    If ``pdf_path`` is None, the call is text-only (no file attachment),
    which is how non-parser consumers (why-selected generator, report
    generator) can use this helper.

    Walks the same model chain with the same retry semantics.
    """
    if models is None:
        models = PARSER_FALLBACK_MODELS

    client = _get_client()

    file_id: Optional[str] = None
    if pdf_path is not None:
        file_id = _upload_pdf(client, pdf_path)

    user_content: List[dict] = [{"type": "input_text", "text": user_prompt}]
    if file_id is not None:
        user_content.append({"type": "input_file", "file_id": file_id})

    _log(f"gen chain = {models}")
    last_exc: Optional[Exception] = None

    for idx, model in enumerate(models):
        is_last = idx == len(models) - 1
        try:
            _log(f"gen attempt {idx + 1}/{len(models)}: model={model}")
            resp = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_content},
                ],
            )
            text = getattr(resp, "output_text", "") or ""
            _log(f"gen OK: model={model} chars={len(text)}")
            return text
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
    return ""
