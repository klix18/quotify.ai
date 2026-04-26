# Quotify AI — LLM Orchestration Reference

```
╔══════════════════════════════════════════════════════════════════════╗
║  Current design:  single-pass-cached-2026-04-21    (updated 4/21)    ║
║  Previous:        baseline-2026-04-20              (see §8)          ║
╚══════════════════════════════════════════════════════════════════════╝
```

This document describes the parser's LLM orchestration so it can be
compared against future designs. Every row in the `parse_metrics`
Postgres table carries a `system_design` tag that pins it to a specific
version of this doc. When the orchestration changes: bump
`SYSTEM_DESIGN_VERSION` in `frontend/src/lib/devMetrics.js`, append a new
§ here describing it, and the viewer (`dev_metrics/viewer.html`)
automatically renders the new tag as its own "Design N" section
alongside the old ones — so you can compare orchestrations side-by-side
on real latency and manual-edit data.

**Where the data lives.** Rows are stored in the `parse_metrics` table
of the Railway Postgres database (same DB as `analytics_events`). The
filesystem of the Railway instance is ephemeral, so file-based storage
was not an option — testers on the live Vercel + Railway deployment
need their events to persist across container restarts and deploys.

**How to view the data.** Open `dev_metrics/viewer.html` in your
browser, enter your Railway backend URL and the `DEV_METRICS_API_KEY`
(the same key you set as an env var on Railway), and click Load. The
viewer fetches `GET /api/dev-metrics/data`, groups rows by
`system_design` tag, renders a table + summary stats per tag, and
offers a JSONL download for raw export.

---

**Contents**

```
§1 · TL;DR                          — one-sentence summary + flow diagram
§2 · Design 1 vs Design 2           — side-by-side at a glance
§3 · Extraction pass                — the single Gemini call + cache
§4 · Why-Selected                   — the single summary call
§5 · Fallback chain                 — what happens when Gemini fails
§6 · Skill layer                    — prompt source files + composition
§7 · parse_metrics rows             — what each row captures
§8 · Legacy: baseline-2026-04-20    — the 3-pass predecessor
§9 · Where to change what           — file/constant lookup + ship checklist
```

---

## §1 · TL;DR

```
┌────────────────────────────────────────────────────────────────────┐
│  POST /api/parse-quote?insurance_type=<type>                       │
│       ↓                                                            │
│  ┌─────────────────────────────┐   ┌──────────────────────────┐    │
│  │ ONE Gemini 2.5 Flash call   │   │ Gemini system-prompt     │    │
│  │ • strict JSON response      │──▶│ cache (TTL 1h) keyed on  │    │
│  │ • streams final_patch       │   │ (type, supps, skill_ver) │    │
│  └──────────┬──────────────────┘   └──────────────────────────┘    │
│             ▼                                                      │
│  ┌─────────────────────────────┐                                   │
│  │ ONE Gemini 2.5 Flash-Lite   │                                   │
│  │ "Why Selected" call          │                                   │
│  └──────────┬──────────────────┘                                   │
│             ▼                                                      │
│         result event                                               │
└────────────────────────────────────────────────────────────────────┘

  If Gemini 503s on the first chunk → OpenAI gpt-4o-mini → gpt-4o
  (DEFAULT_FALLBACKS = []; Gemini-family hopping didn't help.)
```

**One sentence.** A single endpoint (`POST /api/parse-quote`) runs one
strict-JSON pass on `gemini-2.5-flash` over the uploaded PDF, with the
stable system prompt (`CORE_SYSTEM_PROMPT` + full `parse_<type>/SKILL.md`
with carrier overrides baked in) cached via Gemini's explicit
context-cache API so the prefill cost is paid once per
`(type, supplements, skill_version)` tuple, plus a single "Why Selected"
call to summarize the extracted data — with an OpenAI fallback that
kicks in if Gemini fails.

---

## §2 · Design 1 vs Design 2 — side-by-side

| | **Design 1**<br/>`baseline-2026-04-20` | **Design 2**<br/>`single-pass-cached-2026-04-21` |
|---|---|---|
| **LLM calls / parse** | 4–5 | 2 |
| **Carrier detection** | Vision pass on page 1 (`gemini-2.5-flash-lite`) | Baked into each `SKILL.md`; no separate call |
| **Quick draft stage** | `gemini-2.5-flash-lite` streams `draft_patch` events | ✗ removed |
| **Strict JSON extraction** | `gemini-2.5-flash` + response_schema | `gemini-2.5-flash` + response_schema (unchanged) |
| **Self-healing retry** | `gemini-2.5-flash` re-queries low-confidence fields | ✗ removed — confidence drives UI pill only |
| **Why-Selected** | Draft call (from Pass 1 output) + refine call | Single call against final data |
| **System prompt** | Built inline on every request | Served from Gemini explicit context cache (TTL 1h) |
| **Cache key** | — | `(insurance_type, supplements, skill_version)` |
| **Fallback on Gemini error** | flash-lite → flash → 2.0 → 1.5 → OpenAI | Straight to OpenAI (`DEFAULT_FALLBACKS = []`) |
| **Multi-PDF handling** | Wind/hail + bundle-separate supported | Same — preserved across fallback boundary |
| **Events emitted** | `carrier_detected`, `draft_patch`, `final_patch`, `healing_patch`, `result` | `skill_loaded`, `final_patch`, `result` |
| **Thinking budget** | 0 (extraction), varied elsewhere | 512 tokens (keeps confidence calibrated) |
| **Confidence threshold** | `< 0.45` triggered Pass 3 self-heal | `< 0.85` lights "Double Check" pill (frontend) |
| **Config id in logs** | `baseline-2026-04-20` | `single-pass-cached-2026-04-21` |

**Why the reduction.** Once carrier overrides were baked into each base
`SKILL.md` (so Pass 0 could no longer change prompt content) and
confidence scores were being displayed to advisors anyway (so Pass 3
wasn't load-bearing for UX), the fastest path became: one cached
strict-JSON call + one summary call. The removed passes are summarized
in §8's "What changed" table.

---

## §3 · Extraction pass — Strict JSON, single call

```
╭──────────────────────── gemini-2.5-flash ────────────────────────╮
│                                                                  │
│   SYSTEM (cached):   CORE_SYSTEM_PROMPT                          │
│                      + full parse_<type>/SKILL.md                │
│                      + wind_hail or bundle_separate supplement   │
│                        (when applicable)                         │
│                                                                  │
│   USER:              "Extract all fields…"                       │
│                      + multi-PDF boundary wording                │
│                      + attached PDF(s)                           │
│                                                                  │
│   response_schema:   per-type schema from schema_registry.py     │
│                      (includes confidence{} object per leaf)     │
│                                                                  │
│   thinking_budget:   512 tokens                                  │
│                                                                  │
│   Output:            streamed JSON → final_patch events          │
│                                                                  │
╰──────────────────────────────────────────────────────────────────╯
```

**Model:** `gemini-2.5-flash`.

**System prompt.** `CORE_SYSTEM_PROMPT` + the full `parse_<type>/SKILL.md`
(carrier overrides baked in) + any wind/hail or bundle-separate
supplement when applicable. Served from a cached context — we call
`client.caches.create(...)` once per
`(insurance_type, supplement_set, skill_version)` tuple, store the
returned cache name in a process-local registry
(`_SYSTEM_CACHE_REGISTRY`), and pass `cached_content=<name>` in
`GenerateContentConfig` on every subsequent request. TTL is 1 hour; if
the cached entry has been evicted or creation fails, we fall back
transparently to inline `system_instruction=...` for that request — the
parse never blocks on the cache.

**User prompt.** `"Extract all fields..."` with multi-PDF boundary wording
when a second PDF (wind/hail or a split bundle) is attached. The PDFs
themselves are attached via `types.Part.from_uri(file_uri=...)` after
being uploaded to Gemini Files.

**`response_schema`.** A per-insurance-type JSON schema from
`schema_registry.py`. The model is forced to emit a JSON object
matching the schema, including a `confidence` object that mirrors the
data shape and produces a 0.0–1.0 score for every leaf field.

**`thinking_config`.** `ThinkingConfig(thinking_budget=512)`. Kept
intentionally non-zero so the per-field confidence scores remain
well-calibrated — the few hundred milliseconds of planning is a small
price for accurate confidence signals that drive the "Double Check"
UI pill at `confidence < 0.85`.

**Output.** Streamed JSON chunks, emitted to the frontend as `final_patch`
events. The post-processor then walks the JSON-schema tree to fill
missing string leaves with `""`, missing arrays with `[]`, and flattens
`confidence{}` to dot-path form so the UI can look up
`confidence["vehicles.0.vin"]` directly. Also runs lenient JSON
recovery for truncated streams.

### The cache, visualized

```
 cache key  =  (insurance_type, supplement_set, skill_version)
                │
                ▼
 ┌────────────────────────────────────────────────────────────┐
 │  _SYSTEM_CACHE_REGISTRY : dict[str, str]                   │
 │  process-local — each Railway worker has its own copy      │
 │      ↓                                                     │
 │  client.caches.get(name=...)  (verify still alive)         │
 │      ↓                                                     │
 │  GenerateContentConfig(cached_content=<name>, ...)         │
 └────────────────────────────────────────────────────────────┘

 On miss / eviction / creation failure → transparent fallback to
 inline system_instruction=<text> for that request only.
```

- Cache TTL: **1 hour** (`SYSTEM_CACHE_TTL_SECONDS = 3600`).
- Bumping `> VERSION:` in a `SKILL.md` invalidates that type's cache
  entry on the next parse (the version is part of the cache key).
- Each Railway worker pays the cache-create cost once per tuple per
  hour. In a multi-worker deploy each worker has its own registry —
  fine, since caches auto-expire anyway.

---

## §4 · Why-Selected — single summary call

```
╭────────────────── gemini-2.5-flash-lite ─────────────────╮
│  Input:   final post-processed data + insurance_type     │
│  Output:  3–5 bullet points ("• …")                      │
│  Merged into:  data["why_selected"] before result event  │
│                                                          │
│  Returns ""  on any error → never blocks the parse       │
╰──────────────────────────────────────────────────────────╯
```

**Model:** `gemini-2.5-flash-lite` via
`why_selected_generator.generate_why_selected`.

**Input.** The final post-processed `data` dict plus the insurance
type. Critically, this runs *after* `post_process`, so it sees the
same values the UI sees (empty strings filled, arrays defaulted,
confidence flattened).

**Output.** 3–5 bullet points summarizing why this quote is a good
fit. The function prepends `"• "` to each bullet and joins with
newlines, so `data["why_selected"]` is ready to render as a bulleted
list in the UI with no additional processing.

**Error handling.** Returns an empty string on any error (API failure,
rate limit, malformed response, invalid JSON). A hiccup in the
summary call never blocks the parse result — the user still gets
their extracted data, the "Why Selected" box just renders empty.

This replaces the old draft → refine sequence from Design 1. Once
Pass 1 was removed, the refine branch was always fed an empty draft,
so the extra logic was dead code and was collapsed to a single call.

---

## §5 · Fallback chain

```
  ┌──────────────────────────────────────────────────────────┐
  │  1.  gemini-2.5-flash   (primary)                        │
  │          │                                               │
  │          │  fails on first chunk (503 / overload /       │
  │          │  resource_exhausted / quota / timeout)        │
  │          ▼                                               │
  │  2.  DEFAULT_FALLBACKS = []   (empty by design)          │
  │          │                                               │
  │          │  Gemini-family hopping didn't help during     │
  │          │  real 503 waves — when flash is hot,          │
  │          │  flash-lite and flash-2.0 are hot too.        │
  │          ▼                                               │
  │  3.  OpenAI  gpt-4o-mini → gpt-4o                        │
  │          (system_instruction inline — no cache crosses   │
  │           providers, so latency regresses here)          │
  └──────────────────────────────────────────────────────────┘
```

The single extraction call flows through `stream_with_fallback`:

1. **Try primary Gemini model** (`gemini-2.5-flash`). If the first
   streamed chunk comes back cleanly, we commit to this response and
   stream it through to the frontend.
2. **Walk the fallback chain** — `DEFAULT_FALLBACKS` in
   `backend/parsers/_model_fallback.py`. Currently empty: Gemini-family
   hopping (`flash-lite → flash → 2.0 → 1.5`) was the old chain, but we
   observed that during real demand spikes those models share the same
   throttle — when one is 503-ing the others are too. Walking the chain
   just added seconds to the failure path.
3. **Fall through to OpenAI** —
   `_openai_fallback.stream_openai_extraction` walks
   `gpt-4o-mini → gpt-4o`. The system instruction is sent inline here
   (Gemini's cache API doesn't cross providers), so latency regresses
   on the OpenAI path — but it only fires after the Gemini call has
   already failed, so the baseline latency for the happy path is
   unaffected.

**Multi-PDF state** (wind/hail or bundle-separate mode) is preserved
across the fallback boundary — both the primary PDF and any
secondary/wind PDF are attached with the same boundary-marker text in
both providers (`"=== PDF 1 of 2 ==="` / `"=== PDF 2 of 2 ==="`), so
the prompt the OpenAI fallback sees is the same shape the Gemini call
would have seen.

**Non-retryable errors** (bad MIME type, auth failure, file-too-large)
are re-raised immediately without hitting the fallback chain. The
retry logic only kicks in for transient errors whose stringified
message matches one of `_RETRYABLE_SIGNALS` (`503`, `overloaded`,
`resource_exhausted`, `quota`, `rate limit`, `deadline`,
`internal error`, `temporarily`, etc.).

---

## §6 · Skill layer — `parse_<type>/SKILL.md`

```
  backend/parsers/skills/
    parse_homeowners/SKILL.md       ← v2.0 · carriers baked in
    parse_auto/SKILL.md             ← v2.1 · carriers baked in
    parse_dwelling/SKILL.md         ← v2.0 · carriers baked in
    parse_commercial/SKILL.md       ← v2.0 · base only
    parse_bundle/SKILL.md           ← v2.1 · @include home + auto
    parse_bundle_separate/SKILL.md  ← v2.1 · supplement (2-PDF bundle)
    parse_wind_hail/SKILL.md        ← v2.0 · supplement (wind PDF #2)
```

Each file:

```
  ---
  name: parse_<type>
  description: Use this skill when parsing a <type> insurance quote PDF
  ---

  # <type> Insurance Extraction Skill
  > VERSION: 2.x
  > TYPE: <type>
  > @include <other-type>   (optional — parse_bundle uses this)

  ## Fields to Extract
    (detailed per-field rules, aliases, "where to find it" hints)
  ## Type-Specific Rules
    (split-limit formatting, date formats, PDF layout quirks)
  ## Carrier-Specific Overrides
    (per-carrier adjustments for the few carriers that need them)
```

**Loader:** `skill_loader.load_skill(insurance_type)`.

- **YAML frontmatter is stripped** before the body reaches the LLM —
  the `name` / `description` fields are for humans and tooling, not
  for the model.
- **`> @include <type>`** is resolved at load time. `parse_bundle`
  pulls in both `homeowners` + `auto` so the bundle skill contains
  the complete text of both — the LLM sees one concatenated prompt.
  Include directives are stripped from the included body to avoid
  duplicate `VERSION` / `TYPE` headers.
- **Carrier overrides** live inside each base `SKILL.md` under a
  `## Carrier-Specific Overrides` section. Adding a new carrier quirk
  = editing that section in the base file. There are no per-carrier
  patch files (the old layout had separate `parse_<type>/<carrier>.md`
  files that were merged at load time — removed when carrier
  detection became observability-only).
- **Supplements** are appended to the skill text *before* the cache
  lookup, so different supplement combinations naturally hit
  different cache entries — the cache key carries `has_wind` /
  `has_separate` flags derived from which supplements were included.

```
  Cache key includes supplement flags
  ────────────────────────────────────────────────────────────────
  key1 = (homeowners, ∅,                         v2.0)
  key2 = (homeowners, wind_hail,                 v2.0)   ← different cache
  key3 = (bundle,     bundle_separate,           v2.1)
  key4 = (bundle,     bundle_separate+wind_hail, v2.1)   ← yet another
```

---

## §7 · `parse_metrics` rows — what each parse captures

Rows live in the Railway Postgres `parse_metrics` table. Each row is
one JSONB record. There are two event shapes, joined by `parse_id`:

```json
{ "event":           "parse",
  "parse_id":        "uuid",
  "timestamp":       "2026-04-21T14:32:15.123Z",
  "insurance_type":  "homeowners",
  "pdf_count":       1,
  "latency_ms":      4120,
  "system_design":   "single-pass-cached-2026-04-21" }
```

```json
{ "event":                            "quote",
  "parse_id":                         "uuid",
  "timestamp":                        "2026-04-21T14:35:02.991Z",
  "insurance_type":                   "homeowners",
  "manual_changes_all_count":         7,
  "manual_changes_non_client_count":  4,
  "manual_changes": [
    {"field": "client_name", "value": "Kevin Li"},
    {"field": "dwelling",    "value": "$310,000"}
  ],
  "system_design":                    "single-pass-cached-2026-04-21" }
```

```
  ┌──────────┐   1 : 0-or-1   ┌──────────┐
  │  parse   │ ───────────▶   │  quote   │     joined on parse_id
  └──────────┘                └──────────┘     (same session)
```

The viewer joins the two on `parse_id`. Each parse session yields
either one row (parse-only — user bailed without generating a quote)
or two rows (parse + quote).

### "Manual changes" defined

The frontend tracks every form edit the user makes after parsing
completes (per-field, by dotted path for nested arrays — e.g.
`vehicles.0.vin`, `drivers.2.license_state`).

| Column | Counts |
|---|---|
| `manual_changes_all_count` | Every post-parse edit, including client-info fields |
| `manual_changes_non_client_count` | Same, but excludes `client_name` / `named_insured`, `client_address` / `mailing_address`, `client_phone`, `client_email` — these are user-specific, never predictable from the PDF, and would otherwise dominate the accuracy signal |

When comparing designs, `manual_changes_non_client_count` is the
primary accuracy signal: it approximates "how many fields did the
model get wrong that it *could* have gotten right". Client-info
edits aren't the model's fault (they just aren't on the quote), so
they're excluded from the interesting count.

### Viewing the data

```
  dev_metrics/viewer.html
      ↓ (enter Backend URL + DEV_METRICS_API_KEY)
  GET /api/dev-metrics/data          (GATED by X-Dev-Metrics-Key)
      ↓
  Group by system_design tag, newest-first
      ↓
  Render as "Design N — <tag>" sections with per-type summary
  (sessions · avg latency · avg manual edits) + raw session table

  "Download JSONL" button → raw export of every row.
```

Each design tag becomes its own section so you can compare
orchestrations side-by-side on real latency and edit data rather
than from memory.

---

## §8 · Legacy — `baseline-2026-04-20`

The orchestration below was active before 2026-04-21. Rows tagged
`baseline-2026-04-20` in `parse_metrics` follow this pipeline.

```
┌──────────────────────────────────────────────────────────────────┐
│  PASS 0 — Carrier detection (vision)                             │
│  gemini-2.5-flash-lite · page-1 logo → carrier_key               │
│    In v2 skills library, overrides were already baked into the   │
│    base SKILL.md, so the returned carrier_key was recorded in    │
│    parse_metrics for observability only — it didn't change       │
│    prompt content any more.                                      │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASS 1 — Quick draft (key:value streaming)                      │
│  gemini-2.5-flash-lite · QUICK_PASS_SYSTEM_PROMPT                │
│    "field_key: value" lines → draft_patch events                 │
│    UI populated within ~1–2s so the form wasn't empty during     │
│    the slower strict-JSON pass.                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASS 2 — Strict JSON                                            │
│  gemini-2.5-flash · CORE_SYSTEM_PROMPT + full SKILL.md inline    │
│    response_schema with confidence{} → final_patch event         │
│    Same shape as Design 2, but system prompt sent inline every   │
│    time (no cache).                                              │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  PASS 3 — Self-healing retry                                     │
│  gemini-2.5-flash · targeted re-query of low-confidence fields   │
│    trigger:  any confidence < HEALING_THRESHOLD (0.45)           │
│    cap:      HEALING_MAX_FIELDS (8)                              │
│    events:   healing_patch per improved field (non-fatal)        │
│    Merge rule: accept non-empty replacements, or empty           │
│                replacements that confirm an already-empty value. │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  WHY-SELECTED  (draft → refine, 2 calls)                         │
│  Draft call seeded from Pass 1's partial data, refine call       │
│  against Pass 2 data → data["why_selected"]                      │
└──────────────────────────────────────────────────────────────────┘

  Each pass had its own per-call fallback chain:
  flash-lite → flash → 2.0 → 1.5  →  OpenAI gpt-4o-mini → gpt-4o
```

### What changed moving to `single-pass-cached-2026-04-21`

| Removed | Reason |
|---|---|
| Pass 0 vision carrier detection | Carrier overrides baked into each base SKILL.md — a separate detection call no longer changes prompt content, so the round-trip was wasted. `carrier_detector.py` was moved to a `DELETE_` prefix pending full removal. |
| Pass 1 quick key:value draft | Cached system prompt + small thinking budget make the strict-JSON pass fast enough that the progressive-draft stage was net-negative on p50 latency. The UI no longer shows a "filling in…" half-state. |
| Pass 3 self-healing retry | Confidence scores still flow through from the response schema, but they now just drive the frontend "Double Check" pill (advisor review) — not a second LLM call. |
| Draft → refine for Why-Selected | With Pass 1 gone, the refine branch was always fed an empty draft; collapsed to one call against final data. |
| `MODEL_QUICK`, `MODEL_HEAL`, `HEALING_THRESHOLD`, `HEALING_MAX_FIELDS`, `QUICK_PASS_SYSTEM_PROMPT` | Deleted from `unified_parser_api.py` |
| `DEFAULT_QUICK_FALLBACKS` / `DEFAULT_FINAL_FALLBACKS` (+ legacy singulars) | Consolidated into a single `DEFAULT_FALLBACKS: List[str] = []` in `_model_fallback.py` — Gemini-family hopping didn't help during real 503 waves. |

---

## §9 · Where to change what

| I want to change… | Edit | Notes |
|---|---|---|
| Primary extraction model | `MODEL_EXTRACT` in `backend/parsers/unified_parser_api.py` | e.g. swap to `gemini-2.5-pro` |
| Thinking budget | `THINKING_BUDGET` (same file) | Default 512. Zero it for fastest response; loses confidence calibration. |
| Cache TTL | `SYSTEM_CACHE_TTL_SECONDS` (same file) | Default 3600 (1h) |
| System prompt body | `CORE_SYSTEM_PROMPT` (same file) | Cache entries keyed on `skill_version`, not prompt text — bump an affected `SKILL.md` VERSION to force invalidation |
| A skill's content | `backend/parsers/skills/parse_<type>/SKILL.md` | Bump `> VERSION:` to invalidate that type's cache entry |
| Carrier-specific rules | `## Carrier-Specific Overrides` section in the base `SKILL.md` | Same bump-VERSION rule applies |
| Gemini fallback chain | `DEFAULT_FALLBACKS` in `backend/parsers/_model_fallback.py` | Currently `[]`. Add names to hop within Gemini before jumping to OpenAI. |
| OpenAI fallback chain | `backend/parsers/_openai_fallback.py` | Current: `gpt-4o-mini → gpt-4o` |
| Frontend "Double Check" threshold | `CONFIDENCE_THRESHOLD` in `frontend/src/pages/QuotifyHome.jsx` | Default 0.85 |
| Design tag in `parse_metrics` | `SYSTEM_DESIGN_VERSION` in `frontend/src/lib/devMetrics.js` | **Bump this** whenever you change any of the above so old rows stay interpretable |

### Ship checklist for a new design

```
  ┌────────────────────────────────────────────────────────────┐
  │  1. Make the code change.                                  │
  │  2. Bump SYSTEM_DESIGN_VERSION in frontend/src/devMetrics. │
  │  3. Add a new § here (or dev_metrics/design-N.md).         │
  │  4. Update DEFAULT_DESCRIPTIONS in dev_metrics/viewer.html │
  │     so the new tag gets a readable blurb in the viewer.    │
  │  5. Deploy → watch parse_metrics split cleanly between old │
  │     and new tags in the viewer.                            │
  └────────────────────────────────────────────────────────────┘
```

Old rows keep their prior tag and stop accumulating — they don't
pollute the new design's metrics, and the viewer renders them as a
separate "Design N" section so you can compare the two
orchestrations head-to-head on real latency and manual-edit data.
