# Design 2 — `single-pass-cached-2026-04-21`

Shipped 2026-04-21. Replaces Design 1 (`baseline-2026-04-20`).

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
│  • Write upload → tmp .pdf                                           │
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
│  SYSTEM-PROMPT CACHE LOOKUP  (Gemini explicit context-cache, TTL 1h) │
│  • key = (insurance_type, skill_version, has_wind, has_separate)     │
│  • _SYSTEM_CACHE_REGISTRY  → cache name (process-local)              │
│  • client.caches.get() verifies it still exists                      │
│  • On miss / failure → fall back to inline system_instruction=...    │
│  Result: cached_content=<name>   OR   system_instruction=<text>      │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXTRACTION — Strict JSON, SINGLE PASS  (gemini-2.5-flash, STREAMING)│
│  • System (cached): CORE_SYSTEM_PROMPT + full SKILL.md + supplement  │
│  • User: "Extract all {type} fields" + multi-PDF boundary wording    │
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
│  FINALLY (cleanup, BLOCKS the stream 0.3–1.5 s)                      │
│  • client.files.delete() × N  (sync HTTPS to Google, one per PDF)    │
│  • unlink local tmp .pdf                                             │
│  Stream closes ↓                                                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND: stream loop breaks on `done:true`                         │
│  • Apply final data → form state                                     │
│  • setIsParsing(false)                                               │
│  • logParseComplete()  → POST /api/dev-metrics/log                   │
│        latency_ms = performance.now() − startedAt                    │
└──────────────────────────────────────────────────────────────────────┘

   Fallback chain (detected on first chunk, extraction call only):
   gemini-2.5-flash  →  OpenAI gpt-4o-mini  →  OpenAI gpt-4o
   (DEFAULT_FALLBACKS = [] — Gemini-family hopping didn't help during
    real 503 waves, so we fall straight through to OpenAI. System
    instruction is re-sent inline on the OpenAI path; cache doesn't
    cross providers.)


   REMOVED vs Design 1  (baseline-2026-04-20)
   ──────────────────────────────────────────────────────────────────
   ✗ Pass 0 — vision carrier detection on page 1
        Reason: carrier overrides are now baked into each base
        parse_<type>/SKILL.md under ## Carrier-Specific Overrides,
        so a separate detection call no longer changes prompt content.
        carrier_detector.py removed from the hot path.

   ✗ Pass 1 — quick key:value streaming draft
        Reason: the cached system prompt + small thinking budget
        make the single strict-JSON pass fast enough that the
        progressive-draft stage was net-negative on p50 latency.
        No more draft_patch event.

   ✗ Pass 3 — self-healing retry on low-confidence fields
        Reason: confidence scores still flow through from the
        response schema and drive the frontend "Double Check" pill,
        but they no longer trigger a second LLM call.
        No more healing_patch event.

   ✗ Why-Selected DRAFT call  (draft → refine sequence)
        Reason: with Pass 1 gone, the refine branch was always fed
        an empty draft. Collapsed to a single generate_why_selected
        call against the final data.


   WHAT'S STILL THE SAME
   ──────────────────────────────────────────────────────────────────
   ✓ Single endpoint:  POST /api/parse-quote?insurance_type=<type>
   ✓ Skill layer:      parse_<type>/SKILL.md with YAML frontmatter
   ✓ Schema registry:  per-type response_schema + confidence object
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
| `DEFAULT_FALLBACKS` | `[]` | `backend/parsers/_model_fallback.py` |
| `CONFIDENCE_THRESHOLD` (frontend pill) | `0.85` | `frontend/src/pages/QuotifyHome.jsx` |
| `SYSTEM_DESIGN_VERSION` | `single-pass-cached-2026-04-21` | `frontend/src/lib/devMetrics.js` |

Bumping `SYSTEM_DESIGN_VERSION` starts a new design bucket — old
`parse_metrics` rows keep their prior tag and stop accumulating, and
the viewer renders each tag as its own "Design N" section.
