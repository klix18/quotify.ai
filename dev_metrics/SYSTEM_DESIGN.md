# Quotify AI — Current LLM Orchestration (Developer Reference)

**Last updated:** 2026-04-20 · **Config id in logs:** `baseline-2026-04-20`

This document describes the parser's LLM orchestration in simple terms so it
can be compared against future designs. Every row in the `parse_metrics`
Postgres table carries a `system_design` tag that pins the row to a
specific version of this doc — when the orchestration changes, bump the tag
in `frontend/src/devMetrics.js` (`SYSTEM_DESIGN_VERSION`) and append a new
section here describing the new design.

**Where the data lives:** rows are stored in the `parse_metrics` table of
the Railway Postgres database (same DB as `analytics_events`). The
filesystem of the Railway instance is ephemeral, so file-based storage was
not an option — testers on the live Vercel+Railway deployment need their
events to persist across container restarts and deploys.

**How to view the data:** open `dev_metrics/viewer.html` in your browser.
Enter your Railway backend URL and the `DEV_METRICS_API_KEY` (the same key
you set as an env var on Railway). The viewer fetches
`GET /api/dev-metrics/data`, renders a table + chart, and lets you
download the full dataset as JSONL.

---

## One-sentence summary

A single endpoint (`POST /api/parse-quote`) runs a **3-pass Gemini pipeline**
(quick draft → strict JSON → self-healing) over the uploaded PDF, with an
upfront **vision pass** for carrier detection, a **skill + carrier-patch**
prompt layer, and an **OpenAI fallback** that kicks in if every Gemini model
in the chain fails.

---

## The passes (in order)

### Pass 0 — Carrier detection (vision)
- Model: `gemini-2.5-flash-lite` (vision call on page 1)
- Purpose: identify the carrier from its logo (e.g. "frontline",
  "dairyland", "progressive") and load the matching carrier patch
  (`backend/parsers/skills/<type>/<carrier_key>.md`) to append to the base
  skill before the real extraction starts.
- Cost: ~1 small call per parse.

### Pass 1 — Quick draft (key:value streaming)
- Model: `gemini-2.5-flash-lite`
- System prompt: `QUICK_PASS_SYSTEM_PROMPT` — "output field_key: value lines,
  nothing else."
- User prompt: skill content + a "quick-pass field list" (the highest-value
  fields per insurance type) + the PDF(s).
- Output: plain text lines. Streamed to the frontend as `draft_patch` events.
- Purpose: fast first-look so the UI populates fields within ~1-2 seconds.

### Pass 2 — Strict JSON (structured output)
- Model: `gemini-2.5-flash`
- System prompt: `CORE_SYSTEM_PROMPT` + the full merged skill (base +
  carrier patch + any wind/hail or bundle-separate supplement).
- User prompt: "Extract all fields..." with multi-PDF boundary wording when
  applicable.
- `response_schema`: a per-insurance-type JSON schema from
  `schema_registry.py`. The model is forced to emit a JSON object matching
  the schema, including a `confidence` object with a 0.0–1.0 score for every
  leaf field.
- Output: streamed JSON chunks, emitted to the frontend as `final_patch`
  events. The post-processor then fills schema defaults and flattens the
  confidence dict to dot-path form for the UI overlay.

### Pass 3 — Self-healing retry (targeted)
- Model: `gemini-2.5-flash`
- Runs only when Pass 2's confidence for some fields is below
  `HEALING_THRESHOLD = 0.45`.
- Selects up to `HEALING_MAX_FIELDS = 8` lowest-confidence string fields.
- Re-asks Gemini for those specific fields with their current (uncertain)
  values as context. Merges improvements back — only accepts non-empty
  replacements OR empty replacements that confirm an already-empty value.
- Output: `healing_patch` event for each improved field.
- Non-fatal: if Pass 3 errors, Pass 2 data is returned as-is.

---

## Model chain + cross-provider fallback

Each call (Pass 1 / Pass 2 / Pass 3) flows through
`stream_with_fallback` / `generate_with_fallback`:

1. Try primary Gemini model.
2. On error, walk a fallback chain (flash-lite → flash → flash-2.0 →
   flash-1.5).
3. If every Gemini model fails, fall through to the OpenAI path
   (`_openai_fallback.stream_openai_extraction` — GPT-4o-mini → GPT-4o).

Multi-PDF state (wind/hail or bundle-separate mode) is preserved across the
fallback boundary — both the primary PDF and any secondary/wind PDF are
attached with the same boundary-marker text in both providers.

---

## Skill layer

- Base skill: `backend/parsers/skills/<type>.md`. Loaded via
  `skill_loader.load_skill(...)`. Supports `@include other-type` for
  composition (e.g. `bundle.md` includes both `homeowners` and `auto`).
- Carrier patch: `backend/parsers/skills/<type>/<carrier_key>.md`.
  Optional. Appended after the base skill when the carrier is detected.
- Supplements (conditionally appended):
  - `skills/wind_hail.md` — when a separate wind/hail PDF is attached.
  - `skills/bundle_separate.md` — when Bundle is uploaded as two separate
    PDFs (homeowners + auto).

---

## What the `parse_metrics` rows capture

Each row is one JSONB record. Two event shapes:

```json
{"event": "parse",
 "parse_id": "uuid",
 "timestamp": "2026-04-20T14:32:15.123Z",
 "insurance_type": "homeowners",
 "pdf_count": 1,
 "latency_ms": 7834,
 "system_design": "baseline-2026-04-20"}
```

```json
{"event": "quote",
 "parse_id": "uuid",          // same as the matching parse row
 "timestamp": "2026-04-20T14:35:02.991Z",
 "insurance_type": "homeowners",
 "manual_changes_all_count": 7,
 "manual_changes_non_client_count": 4,
 "manual_changes": [
   {"field": "client_name", "value": "Kevin Li"},
   {"field": "dwelling", "value": "$310,000"}
 ],
 "system_design": "baseline-2026-04-20"}
```

The viewer joins the two on `parse_id` — each parse session yields either
one row (parse-only, no quote generated) or two rows (parse + quote).

**"Manual changes" defined:** the frontend tracks every form edit the user
makes after parsing completes (per-field, by dotted path for nested
arrays). "all_count" includes every edit. "non_client_count" excludes the
four client-info fields — `client_name` / `named_insured`,
`client_address` / `mailing_address`, `client_phone`, `client_email` —
because those are user-specific and never predictable from the PDF, so
they'd otherwise dominate the noise in the "accuracy" signal.

---

## Where to change the design

- Models: `backend/parsers/unified_parser_api.py` — `MODEL_QUICK`,
  `MODEL_FINAL`, `MODEL_HEAL` constants at the top of the file.
- Healing threshold: same file — `HEALING_THRESHOLD`, `HEALING_MAX_FIELDS`.
- System prompts: same file — `QUICK_PASS_SYSTEM_PROMPT`,
  `CORE_SYSTEM_PROMPT`.
- Skill content: `backend/parsers/skills/*.md`.
- Model fallback chain: `backend/parsers/_model_fallback.py` —
  `DEFAULT_QUICK_FALLBACKS`, `DEFAULT_FINAL_FALLBACKS`.
- OpenAI fallback chain: `backend/parsers/_openai_fallback.py`.

When you change any of the above, **bump the `SYSTEM_DESIGN_VERSION` in
`frontend/src/devMetrics.js`** and append a new section to this file so old
rows in `parse_metrics.jsonl` remain interpretable.
