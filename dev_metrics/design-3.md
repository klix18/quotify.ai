# Design 3 — `fitz-fastpath-2026-04-30`

Shipped 2026-04-30. Replaces Design 2 (`single-pass-cached-2026-04-21`).

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND:  parse<Type>File()  in QuotifyHome.jsx                    │
│  • startParseTimer() → parse_id + performance.now()                  │
│  • POST /api/parse-quote?insurance_type=<type>   (FormData: file)    │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BACKEND:  parse_quote()  in unified_parser_api.py                   │
│  • Write upload(s) → tmp .pdf                                        │
│  • Persist raw PDF to Postgres (best-effort, non-blocking)           │
│  • Return StreamingResponse(stream_unified_quote(...))               │
└──────────────────────────┬───────────────────────────────────────────┘
                           │   (ndjson stream begins)
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SKILL LOAD + SCHEMA LOOKUP   (no LLM call)                          │
│  • skill_loader.load_skill(type) → SKILL.md body (frontmatter strip) │
│  • schema_registry.get_registration(type) → response_schema          │
│  • Append wind/hail or bundle_separate supplement to skill text      │
│  yield  {type: "skill_loaded", skill_type, version}                  │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ★ NEW ★  FITZ FAST-PATH PRE-PASS   (local PyMuPDF, no LLM call)    │
│  • _fitz_fastpath.extract_pdf_text() runs on every attached PDF      │
│  • _fitz_fastpath.is_text_adequate() checks each:                    │
│       ≥200 chars stripped  AND  alphanumeric ratio ≥ 0.30            │
│  • input_mode = "text"  if ALL attached PDFs adequate                │
│                  "vision" if ANY fails (or is image-only)            │
│  • One stderr log line per parse:                                    │
│       [fitz-fastpath] mode=text   primary=2429 chars  alnum=0.75 ... │
│       [fitz-fastpath] mode=vision primary=0 chars     alnum=0.00 ... │
│  No event emitted — the decision is logged but not surfaced to UI.   │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  IF input_mode == "vision":  upload all PDFs to Gemini Files API     │
│  IF input_mode == "text":    skip uploads — extracted text is input  │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SYSTEM-PROMPT CACHE LOOKUP  (Gemini explicit context-cache, TTL 1h) │
│  • key = (insurance_type, skill_version, has_wind, has_separate,     │
│           input_mode)             ← input_mode is NEW in Design 3    │
│  • _SYSTEM_CACHE_REGISTRY  → cache name (process-local)              │
│  • client.caches.get() verifies it still exists                      │
│  • On miss / failure → fall back to inline system_instruction=...    │
│  Result: cached_content=<name>   OR   system_instruction=<text>      │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXTRACTION — Strict JSON, SINGLE PASS  (gemini-2.5-flash, STREAMING)│
│  • System (cached): CORE_SYSTEM_PROMPT + full SKILL.md + supplement  │
│       + TEXT_MODE_CONFIDENCE_RUBRIC  (only on text path)             │
│  • User (text mode):    "Extract …" + inlined extracted text         │
│        (multi-PDF: same boundary labels reused as text headers)      │
│  • User (vision mode):  "Extract …" + uploaded PDF parts             │
│        (multi-PDF: boundary labels interleaved between file parts)   │
│  • response_schema = per-type JSON schema (includes confidence{})    │
│  • thinking_config = ThinkingConfig(thinking_budget=512)             │
│  • Streaming partial JSON reconstruction                             │
│  yield  {type: "final_patch", data: {…}}   ← confidence scores too   │
│  post_process(): fill schema defaults + flatten confidence           │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  WHY-SELECTED  (synchronous single call, BLOCKS the stream ~1 s)     │
│  • gemini-2.5-flash-lite, non-streaming                              │
│  • Input: final post-processed data + insurance_type                 │
│  • Output: 3–5 bullets → data["why_selected"]                        │
│  • Returns "" on any error (never blocks the parse result)           │
│  yield  {type: "result", data, confidence, skill_version}            │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FINALLY (cleanup)                                                    │
│  • TEXT mode:   only the local tmp .pdf(s) need unlinking            │
│                 (no Files-API uploads were made — nothing to delete) │
│  • VISION mode: client.files.delete() × N + unlink local tmp .pdf    │
│  Stream closes ↓                                                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND: stream loop breaks on `done:true`                         │
│  • Apply final data → form state                                     │
│  • setIsParsing(false)                                               │
│  • logParseComplete()  → POST /api/dev-metrics/log                   │
│        latency_ms = performance.now() − startedAt                    │
│        system_design = "fitz-fastpath-2026-04-30"                    │
└──────────────────────────────────────────────────────────────────────┘

   Fallback chain (detected on first chunk, extraction call only):
   gemini-2.5-flash  →  OpenAI gpt-4o-mini  →  OpenAI gpt-4o
   (DEFAULT_FALLBACKS = []. The OpenAI fallback ALWAYS re-uploads the
    PDF and runs in vision mode — even when the primary Gemini call
    ran in text mode. The fallback closure passes
    system_with_skill_vision (without TEXT_MODE_CONFIDENCE_RUBRIC) so
    the rubric matches the actual input. System instruction is sent
    inline; cache doesn't cross providers.)


   ★ ADDED in Design 3
   ──────────────────────────────────────────────────────────────────
   ✓ Local PyMuPDF (fitz) pre-pass before any file upload
        File: backend/parsers/_fitz_fastpath.py (new module).
        Pure helpers — no network calls, no side effects.
        Decides input_mode based on adequacy of EVERY attached PDF.

   ✓ Two input modes: TEXT (inline extracted text) vs VISION (PDF upload)
        Text path skips the Gemini Files API entirely on the ~80% of
        quotes whose PDFs have a clean text layer. Vision path is
        preserved unchanged for image-only quotes (scans, faxes, etc.).

   ✓ TEXT_MODE_CONFIDENCE_RUBRIC appended on text path
        CORE_SYSTEM_PROMPT's vision-grounded rubric ("blurry", "partially
        visible") doesn't apply when the model never sees pixels. The
        text rubric rewrites scoring in terms of textual signals
        (label-adjacency, table-flattening) so the frontend "Double
        Check" pill keeps firing on ambiguous extractions.

   ✓ Cache key gains input_mode dimension
        Vision and text rubrics live as separate cache entries:
        (insurance_type, supplements, skill_version, input_mode).
        Worst case 2× the cache entries per (type, supps, skill_ver).

   ✓ pymupdf==1.27.2.3 added to backend/requirements.txt


   WHAT'S STILL THE SAME
   ──────────────────────────────────────────────────────────────────
   ✓ Single endpoint:  POST /api/parse-quote?insurance_type=<type>
   ✓ Single Gemini extraction call + single Why-Selected call (Design 2)
   ✓ Skill layer:      parse_<type>/SKILL.md with YAML frontmatter
   ✓ Carrier overrides baked into base SKILL.md (no Pass 0 detection)
   ✓ Schema registry:  per-type response_schema + confidence object
   ✓ Streaming events: skill_loaded · final_patch · result
   ✓ Multi-PDF labels: ── PDF #1 of 2 (HOMEOWNERS QUOTE) ── etc.
                       (reused as inline text headers in text mode)
   ✓ Frontend:         confidence < 0.85 → "Double Check" pill
   ✓ Metrics:          every parse logs a row in parse_metrics with
                       the system_design tag above
```

---

## Key constants

| Name | Value | File |
|---|---|---|
| `MODEL_EXTRACT` | `gemini-2.5-flash` | `backend/parsers/unified_parser_api.py` |
| `THINKING_BUDGET` | `512` | same |
| `SYSTEM_CACHE_TTL_SECONDS` | `3600` | same |
| `TEXT_MODE_CONFIDENCE_RUBRIC` | (~50-line addendum) | same |
| `MIN_ADEQUATE_CHARS` | `200` | `backend/parsers/_fitz_fastpath.py` |
| `MIN_ALPHANUM_RATIO` | `0.30` | same |
| `DEFAULT_FALLBACKS` | `[]` | `backend/parsers/_model_fallback.py` |
| `CONFIDENCE_THRESHOLD` (frontend pill) | `0.85` | `frontend/src/pages/QuotifyHome.jsx` |
| `SYSTEM_DESIGN_VERSION` | `fitz-fastpath-2026-04-30` | `frontend/src/lib/devMetrics.js` |

Bumping `SYSTEM_DESIGN_VERSION` starts a new design bucket — old
`parse_metrics` rows keep their prior tag and stop accumulating, and
the viewer renders each tag as its own "Design N" section by
first-seen chronology.

---

## Expected impact

Measured against the Quotify standalone eval corpus (13 homeowners + 5
auto PDFs) before deployment:

| Input shape | Mode | Latency vs Design 2 | Accuracy vs Design 2 |
|---|---|---|---|
| Text-layer PDF (~80% of quotes) | TEXT | **−30 to −50%** | within 2% |
| Image-only PDF (scanned, fax) | VISION | unchanged | unchanged |
| Multi-PDF bundle, both text-layer | TEXT | **−30 to −50%** | within 2% |
| Multi-PDF bundle, any image-only | VISION | unchanged | unchanged |

Image-token cost on the text path is zero — that's where the latency
and dollar savings come from. Accuracy regression on column-heavy
carriers (e.g. Auto-Owners billing tables) is recoverable via
worked-example layout hints in the relevant `SKILL.md` — same pattern
that fixed the Quotify prototype's auto extraction at 96.9%.

---

## How to roll back

Set `SYSTEM_DESIGN_VERSION = "single-pass-cached-2026-04-21"` in
`frontend/src/lib/devMetrics.js` and either:

- **Surgical:** monkey-patch `is_text_adequate` to `lambda _: False`
  in `unified_parser_api.py` so every parse falls through to vision
  mode. Keeps the new code paths intact for fast re-enable. OR
- **Full revert:** `git revert` the Design 3 commit. Cache entries
  with the `text` segment stay in the registry until they TTL out
  (1 hour) — harmless, they just won't be hit anymore.

The `parse_metrics` table will start writing the Design 2 tag again
on the next deploy; rows already written under Design 3 keep that tag
forever and continue to render as a separate section in the viewer.
