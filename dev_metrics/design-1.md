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
│  PASS 0 — Carrier Detection (vision)                                 │
│  • upload_with_retry() → Gemini Files API                            │
│  • detect_carrier(): gemini-2.5-flash-lite vision call on page 1     │
│  • Load base skill + carrier patch from skills/<type>/<carrier>.md   │
│  yield  {type: "carrier_detected"}                                   │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PASS 1 — Quick draft  (gemini-2.5-flash-lite, STREAMING)            │
│  • System: QUICK_PASS_SYSTEM_PROMPT                                  │
│  • User:   skill + quick-pass field list + "field_key: value" format │
│  • Progressive line parsing                                          │
│  yield  {type: "draft_patch", data: {…partial…}}   ← form fills in   │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PASS 2 — Strict JSON   (gemini-2.5-flash + response_schema)         │
│  • System: CORE_SYSTEM_PROMPT + full skill                           │
│  • Streaming partial JSON reconstruction                             │
│  yield  {type: "final_patch", data: {…}}   ← confidence scores too   │
│  post_process(): fill schema defaults + flatten confidence           │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PASS 3 — Self-healing (only if any confidence < 0.45, max 8 fields) │
│  • gemini-2.5-flash, targeted re-extraction of just those fields     │
│  yield  {type: "healing_patch", data: {…}}   ← last visible update   │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  WHY-SELECTED REFINE  (synchronous, BLOCKS the stream 1–2 s)         │
│  • gemini-2.5-flash-lite, non-streaming                              │
│  • Produces "Why this plan" bullets                                  │
│  yield  {type: "result", data, confidence, skill_version, carrier}   │
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

   Per-pass fallback chain if Gemini errors/quota-fails:
   flash-lite → flash → flash-2.0 → flash-1.5 → OpenAI gpt-4o-mini → gpt-4o