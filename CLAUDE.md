# CLAUDE.md — Quotify AI

Codebase guide for Claude. Reflects state on branch
`claude/angry-benz-8bf5e6` (worktree from main @ `d6e6c9d`).

This file is intentionally short and stable. It explains where things
live, what they do, and the invariants you must not break. Detailed
change history lives in `git log`, not here.

---

## 1 · What this product is

**Sizemore Snapshot / Quotify AI** — an internal quote-extraction +
quote-generation tool for Sizemore Insurance advisors.

Workflow:
1. Advisor uploads a carrier quote PDF (or two PDFs in bundle / wind
   modes).
2. Backend extracts structured fields with Gemini (text fast-path via
   PyMuPDF when adequate, otherwise vision).
3. Advisor reviews + edits in a per-type form on the frontend.
4. Frontend posts the edited form back; backend renders a branded
   Sizemore quote PDF (Jinja → Chromium → qpdf) and returns it.
5. Every parse + quote round-trip emits an analytics event.

Admins also get a dashboard, an analytics chatbot ("Snappy"), an
auto-clear job for stored PDFs, an automated email-report generator,
and a self-improving "skill_updater" Streamlit app.

---

## 2 · Top-level layout

```
quotify-ai/
├── backend/                    FastAPI (Dockerfile entry: uvicorn main:app)
│   ├── main.py                 lifespan + CORS + router mounts
│   ├── api/                    FastAPI routers
│   │   ├── advisor_info_api.py     /api/advisors  (Excel-backed, OPEN)
│   │   ├── analytics_api.py        /api/admin/analytics/*  (admin)
│   │   │                            + /api/analytics/me  (self)
│   │   ├── chat_api.py             /api/chat/*  (Snappy SSE chatbot)
│   │   ├── clerk_users_api.py      /api/admin/users/*
│   │   ├── dev_metrics_api.py      /api/dev-metrics/log (OPEN)
│   │   │                            + /api/dev-metrics/data (key-gated)
│   │   ├── pdf_storage_api.py      /api/pdfs/*
│   │   ├── settings_api.py         /api/admin/settings/*
│   │   └── track_api.py            /api/track-event
│   ├── core/
│   │   ├── auth.py                 Clerk JWT verification (JWKS-cached)
│   │   ├── browser_manager.py      Playwright Chromium singleton
│   │   └── database.py             asyncpg pool, init_db, table writers
│   ├── services/
│   │   ├── auto_clear_task.py      hourly background loop, deletes PDFs
│   │   ├── chat_memory.py          session + long-term chatbot memory
│   │   ├── pdf_optimizer.py        qpdf wrapper
│   │   ├── pdf_storage_helpers.py  store_uploaded_pdf / store_generated_pdf
│   │   ├── report_generator.py     Resend-emailed admin report (also a router)
│   │   └── why_selected_generator.py  "Why this plan?" bullets
│   ├── scripts/
│   │   └── user_id_backfill.py     Clerk-id consolidation (runs at startup)
│   ├── parsers/                Single-pass extraction pipeline
│   │   ├── unified_parser_api.py   POST /api/parse-quote (single endpoint)
│   │   ├── _fitz_fastpath.py       text-mode pre-pass (PyMuPDF)
│   │   ├── _model_fallback.py      Gemini → OpenAI cross-provider fallback
│   │   ├── _openai_fallback.py     OpenAI Responses API path (vision-only)
│   │   ├── post_process.py         schema-driven default-fill + name title-case
│   │   ├── schema_registry.py      per-type JSON schemas
│   │   ├── skill_loader.py         loads parse_<type>/SKILL.md (+ @include)
│   │   └── skills/parse_<type>/SKILL.md
│   ├── fillers/                Five near-identical PDF generators
│   │   ├── _filename.py            shared filename builder
│   │   └── <type>_filler_api.py    POST /api/generate-<type>-quote
│   ├── skills/                 Snappy chatbot skill markdown (admin/advisor)
│   ├── templates/              Jinja2 + CSS for quote PDFs (base.html, per-type)
│   ├── advisor_info_list/      .xlsx data source for /api/advisors
│   ├── fonts/                  bundled fonts for PDF rendering
│   ├── generated_quotes/       on-disk staging for rendered PDFs
│   └── requirements.txt
│
├── frontend/                   Vite + React 19 + Clerk + react-router
│   ├── src/main.jsx                ClerkProvider + BrowserRouter + <App/>
│   ├── src/App.jsx                 SignInPage, TopNav, MobileBlocker, routes
│   ├── src/pages/
│   │   ├── QuotifyHome.jsx         3,800-line main quote workflow
│   │   ├── AdminDashboard.jsx      2,300-line admin analytics
│   │   └── ChatMemoryPage.jsx      memory inspector
│   ├── src/components/ChatPanel.jsx  Snappy SSE consumer
│   ├── src/panels/<Type>Panel.jsx  five per-type review forms
│   ├── src/configs/<type>Config.js five per-type field constants
│   ├── src/lib/{colors,trackEvent,sparkleFlow,devMetrics}.js
│   ├── src/styles/{index.css,App.css}
│   ├── package.json / vite.config.js / vercel.json
│
├── skill_updater/              Streamlit-driven self-improvement loop
│   ├── app.py                  3-section UI (run / proposals / history)
│   ├── pipeline.py             per-event analyzer → per-type synthesizer
│   ├── analyzer.py             Gemini vision finder
│   ├── synthesizer.py          GPT-5 strict json_schema proposal
│   ├── diff_review.py          line-level diff parsing
│   ├── skill_io.py             read/write backend SKILL.md files
│   ├── db.py                   own asyncpg pool (no backend imports)
│   ├── models.py               Pydantic shapes
│   ├── prompts/, migrations/, findings/
│
└── dev_metrics/
    ├── viewer.html             standalone HTML viewer (key-gated GET)
    ├── SYSTEM_DESIGN.md        narrative for each design version
    └── design-{1,2,3}.md       legacy design notes
```

### Import conventions

- Backend: `from core.X`, `from services.X`, `from api.X`, `from
  scripts.X`, `from parsers.X`, `from fillers.X`. The `skills/`
  directory (chatbot prompts) is at root and imports as `from skills`.
- Frontend pages/components: relative imports — `../lib/X`, `../configs/Y`,
  `../panels/Z`. Root files use `./lib/X`, `./pages/X`, `./styles/X`.
- `skill_updater/` has its own `db.py` and never imports from `backend/`.
  It connects to the same Postgres but loads SKILL.md files via
  filesystem paths in `skill_io.py`.

---

## 3 · Data flow — parse pipeline (Design 3, `fitz-fastpath-2026-04-30`)

`POST /api/parse-quote?insurance_type=<type>` with a `file` field
(plus optional `wind_file`, `secondary_file`):

1. Validate `insurance_type` via [`schema_registry.get_registration`](backend/parsers/schema_registry.py:471).
2. Load `parse_<type>/SKILL.md` via [`skill_loader.load_skill`](backend/parsers/skill_loader.py:74).
3. Persist uploaded PDF(s) to `pdf_documents` (best-effort, never blocks).
4. **Fitz fast-path:** [`_fitz_fastpath.is_text_adequate`](backend/parsers/_fitz_fastpath.py)
   decides per-PDF. If ALL pass, enter TEXT mode and inline the text in
   the user prompt; otherwise VISION mode and upload via Files API.
5. Build a Gemini explicit context cache for `(insurance_type,
   skill_version, has_wind, has_separate, input_mode)`. TTL 1 hour.
   Falls back to inline `system_instruction` on cache failure.
6. Single extraction call on `gemini-2.5-flash`:
   - `cached_content = <cache name>` (or inline system) +
     CORE_SYSTEM_PROMPT + full SKILL.md + `TEXT_MODE_CONFIDENCE_RUBRIC`
     when text mode.
   - `response_schema` = per-type schema from the registry.
   - `thinking_config = ThinkingConfig(thinking_budget=512)` so
     confidence scores stay calibrated.
   - Streams `final_patch*` events to frontend.
7. On Gemini failure → OpenAI fallback (`gpt-4o-mini` → `gpt-4o`).
   Always re-uploads PDFs as vision parts. No cache.
8. [`post_process.post_process`](backend/parsers/post_process.py:201)
   fills schema defaults, replaces `None` with `""`, title-cases
   client/named/driver/agent name fields, and flattens confidence
   to dot-paths.
9. [`why_selected_generator.generate_why_selected`](backend/services/why_selected_generator.py)
   produces the bullets (single Gemini Flash Lite call).
10. Final `result` event: `{data, confidence, skill_version}`.

### What was removed vs older designs

- Pass 0 (vision carrier detect) — carriers baked into each SKILL.md.
- Pass 1 (quick-key:value draft) — single pass beats two on p50.
- Pass 3 (low-confidence self-heal retry) — confidence still drives
  the frontend "Double Check" pill, just no second LLM call.
- Why-selected draft/refine split — single call now.

---

## 4 · Data flow — quote PDF generation

Frontend posts edited quote object to `/api/generate-<type>-quote`:

1. Filler renders `templates/<type>/<type>_quote.html` via Jinja2.
2. HTML is written to a UUID-named temp file inside the template
   directory (so Chromium resolves `assets/` and `fonts/` via
   `file://`), and Chromium loads it via `as_uri()`.
3. `await page.pdf(...)` writes the PDF to `backend/generated_quotes/`.
4. `pdf_optimizer.optimize_pdf(path)` runs `qpdf` for lossless
   compression + linearization.
5. `pdf_storage_helpers.store_generated_pdf(...)` saves to Postgres
   (best-effort; storage failures don't break the response).
6. `FileResponse` streams the file back.

The five fillers (`auto`, `homeowners`, `dwelling`, `bundle`,
`commercial`) follow the same skeleton with different Jinja contexts.

---

## 5 · Analytics + chatbot data flow

- Every workflow hits `POST /api/track-event` →
  [`database.log_event`](backend/core/database.py:270).
- `analytics_api.py` serves admin queries from `analytics_events`;
  `/api/analytics/me` is the self-service variant.
- `chat_api.py` builds an analytics context block on every message
  and streams `gpt-4o` SSE.
- `chat_memory.py`: in-memory session (30-min TTL) + DB-persisted
  session summaries + long-term insight memories (deduped via word-
  overlap heuristic).
- `report_generator.py` assembles a period report, asks Gemini for HTML,
  and emails admins via Resend.

---

## 6 · Source-of-truth invariants — DO NOT BREAK

1. **Clerk `user_id` is the ONE stable identity.** `user_name` is
   display-only and may collide. NEVER GROUP BY or filter by `user_name`
   when `user_id` is available.
2. **`analytics_events` is the ONE source of truth for counts.**
   `pdf_documents` mirrors attribution but is not queried for
   leaderboard numbers.
3. **`user_id_backfill.py` is gated by `user_id IS NULL OR user_id = ''`**
   so it can never overwrite an existing attribution. Safe to run
   repeatedly.
4. **`track_api.py` rejects JWTs missing `sub`** with 401 — no row is
   ever written with `user_id=''` again.
5. **All time bucketing uses `America/New_York`**, not UTC midnight,
   because Sizemore is on the East Coast. See `analytics_api.py:19`.
6. **Cache key dimensions:** `(insurance_type, skill_version, has_wind,
   has_separate, input_mode)`. Bumping `> VERSION:` in a SKILL.md
   invalidates that type's cache automatically.
7. **`> VERSION:` line in every SKILL.md** drives `skill_version` in
   `parse_metrics` and the cache key. Bump it when editing.
8. **Field-name parity matters:** the bundle frontend reads
   `home_premium / auto_premium / bundle_total_premium`, NOT the
   `*_total_premium` legacy names. Backend schema must agree.
9. **Dwelling + Commercial use `named_insured` + `mailing_address`** as
   canonical fields; their fillers alias to `client_name` /
   `client_address` so `base.html` populates.
10. **Frontend `trackEvent` is awaited** — fire-and-forget loses events
    when the browser navigates to the download URL.

---

## 7 · Database tables (live in `core/database.py:init_db`)

- `analytics_events` — main event log. Indexed on `created_at`,
  `user_id`, `user_name`, `insurance_type`.
- `pdf_documents` — PDF blobs (BYTEA). Indexed on `created_at`,
  `user_id`, `insurance_type`, `doc_type`.
- `app_settings` — key-value (e.g. `pdf_auto_clear`,
  `pdf_auto_clear_last`).
- `chat_session_memories` — Snappy session summaries.
- `chat_insight_memories` — Snappy long-term memories (per user).
- `parse_metrics` — dev-only latency + manual-edit counts joined by
  `parse_id`. Indexed on `created_at`, `parse_id`, `event`.

`skill_updater/migrations/001_skill_updater.sql` adds the parallel
`skill_runs` / `skill_event_analysis` / `skill_proposals` /
`skill_history` tables to the same database.

---

## 8 · Routes overview (auth required unless noted)

| Method | Route | Auth | File |
|---|---|---|---|
| POST | `/api/parse-quote` | user | `parsers/unified_parser_api.py` |
| POST | `/api/generate-<type>-quote` (×5) | user | `fillers/*_filler_api.py` |
| POST | `/api/track-event` | user | `api/track_api.py` |
| GET | `/api/advisors` | **OPEN** | `api/advisor_info_api.py` |
| GET | `/api/advisors/by-name` | **OPEN** | `api/advisor_info_api.py` |
| GET | `/api/admin/analytics/*` | admin | `api/analytics_api.py` |
| GET | `/api/analytics/me` | user | `api/analytics_api.py` |
| GET/POST/DELETE | `/api/pdfs/*` | user (delete = admin) | `api/pdf_storage_api.py` |
| GET/PATCH | `/api/admin/users/*` | user list = user; PATCH role = admin | `api/clerk_users_api.py` |
| GET/POST/DELETE | `/api/chat/*` | user | `api/chat_api.py` |
| POST/GET | `/api/admin/settings/auto-clear` | user GET, admin PUT | `api/settings_api.py` |
| POST/GET | `/api/reports/*` | admin | `services/report_generator.py` |
| POST | `/api/dev-metrics/log` | **OPEN** (intentional) | `api/dev_metrics_api.py` |
| GET | `/api/dev-metrics/data` | `X-Dev-Metrics-Key` header | `api/dev_metrics_api.py` |

---

## 9 · Audit findings — status

Audit run 2026-05-05. Severity in `[brackets]`. **Fixed** items have
been resolved on this branch; **Open** items are still outstanding.

### Critical — all fixed

- **CRIT-1 [Fixed]** `/api/parse-quote` and all five
  `/api/generate-*-quote` endpoints now require a Clerk JWT via
  `Depends(get_current_user)`. The verified `user_id` and a best-effort
  `user_name` are threaded through every `store_*_pdf` call, so
  uploaded + generated PDFs are properly attributed in
  `pdf_documents`. Frontend (`QuotifyHome.jsx`) sends
  `Authorization: Bearer ${token}` on all 7 fetch sites (6 parse + 1
  generate).
- **CRIT-2 [Fixed]** [`auth.py`](backend/core/auth.py) now pins `iss`
  to the configured Clerk frontend API and validates `azp` against an
  explicit `_ALLOWED_AZP_ORIGINS` allowlist (mirrors CORS origins). A
  `_ALLOW_MISSING_AZP = True` safety valve is in place for the rollout
  — flip to `False` once production tokens reliably include `azp`.
  Tokens with mismatched `iss` or `azp` raise 401.
- **CRIT-3 [Mitigated]** Per product decision, advisors keep the
  ability to download any PDF (the snapshot history is a shared
  workspace). The mitigation is full audit logging instead of access
  control: `pdf_storage_api.download_document` now writes an
  `analytics_events` row with `action='download'` recording who pulled
  which PDF. Same treatment for `delete` and `delete_all`. See
  `core/database.log_event(action=...)` and §10 below.

### High

- **HIGH-1 [Fixed]** `main.py` CORS now uses explicit method + header
  lists (no wildcards). See `backend/main.py:67-77`.
- **HIGH-2 [Open — accepted]** `skill_updater/app.py` is still
  Streamlit-without-auth, run locally only. The Streamlit "Initialize
  / migrate DB schema" button now applies every
  `migrations/*.sql` file in the folder (was 001 only), so adding a
  new migration is just a matter of dropping a `003_*.sql` in.
- **HIGH-3 [Fixed]** `_fetch_jwks` now uses
  `httpx.AsyncClient(timeout=5.0)` AND wraps the cache + fetch in an
  `asyncio.Lock` with a double-check so a cold-cache burst can't fan
  out N parallel Clerk calls. See `auth.py:71-95`.
- **HIGH-4 [Open]** `start_auto_clear_loop` does `try/except` per
  cycle but a CancelledError or asyncio internal error could still kill
  the loop. Acceptable today (single-worker Railway deploy).
- **HIGH-5 [Open]** `main.py` lifespan still does
  `auto_clear.cancel()` without awaiting. Leaves a brief window where
  the loop may still execute past lifespan close. Cosmetic.
- **HIGH-6 [Fixed (partial)]** Parsers + fillers now pass `user_id` and
  `user_name` to `store_*_pdf` (the JWT dep at the route level
  guarantees they're set). The `analytics_events.uploaded_pdf`
  column-not-being-set claim was wrong on review — the frontend
  `trackEvent.js` already passes `uploadedPdf` through.

### Medium

- **MED-1 [Fixed]** Generated PDFs are no longer written to disk.
  Fillers call `page.pdf()` without `path=` (returns bytes), pipe
  through `optimize_pdf_bytes()` (qpdf via stdin/stdout), `Response`
  back as `application/pdf`. The `backend/generated_quotes/` directory
  is no longer used.
- **MED-2** `database.py:212` `list_pdfs` and `:352` `get_pdf_stats`
  build `WHERE` clauses with f-string concatenation. Currently safe
  because filter names come from FastAPI Query types, but the pattern
  is fragile — a future "field" param could be exploited.
- **MED-3** `database.py:264,341` parse `result == "DELETE 1"` and
  `int(result.split()[-1])` from asyncpg's status string. Same
  fragile pattern in `analytics_api.py:378,402,423` and
  `user_id_backfill.py:132,146,159,170`. asyncpg has no API guarantee
  about that string format.
- **MED-4** `user_id_backfill.py:112-180` runs four UPDATEs per Clerk
  user without wrapping them in `async with conn.transaction()`. If a
  partial failure happens mid-user, attribution can be inconsistent
  across analytics_events / pdf_documents.
- **MED-5** `auto_clear_task.py` does a read–check–write on
  `pdf_auto_clear_last` without `SELECT FOR UPDATE` or a transaction.
  In a multi-worker deploy, two workers could both decide deletion is
  due and call `delete_all_pdfs()` simultaneously.
- **MED-6** `chat_memory.py:228` (`_extract_memories`) fetches all
  active memories per new memory candidate — O(n×m) deduplication
  that runs per session-end.
- **MED-7** `chat_memory.py:288-292` updates `last_accessed +
  access_count` with one UPDATE per row inside the result-iteration
  loop — should be a single `WHERE id = ANY($1::uuid[])`.
- **MED-8** Process-local `_SYSTEM_CACHE_REGISTRY` (and `_skill_cache`,
  `_jwks_cache`, `_sessions`) means each uvicorn worker has its own
  state. Cache-create cost is paid per worker per day. Acceptable but
  worth knowing.
- **MED-9** `dev_metrics_api.py:84` POST is intentionally open but
  doesn't validate `insurance_type` against the registry, doesn't cap
  string lengths on `system_design`, and has no rate limit. A noisy
  client (or bot) can pollute the table indefinitely.
- **MED-10** `report_generator.py:98` computes `prev_cutoff = cutoff -
  (now - cutoff)` — for the "weekly" period that's correct, but for
  "monthly" cutoff = now - 30 days the prev window is also 30 days
  and ends *at* cutoff, which is fine. However `_period_cutoff` for
  unknown report types silently falls through to monthly.
- **MED-11** Streamlit `app.py:33-45` uses `asyncio.run()` per
  interaction, which creates a fresh loop. The `db.py` pool tracks the
  loop id and rebuilds on change, but the *old* pool is leaked
  (pool.close() is never awaited), wasting open Postgres connections
  on each Streamlit rerun until GC.
- **MED-12** Bundle confidence emits `{}` in both text + vision modes
  (pre-existing — see helper map). Snapshots still parse correctly,
  but the "Double Check" pill silently never fires for bundles.

### Low

- **LOW-1** `database.py:341` `delete_all_pdfs()` issues a single
  `DELETE FROM pdf_documents` — no batching. If the table grows large
  this can lock-out other queries for minutes.
- **LOW-2** `_content_similar` in `chat_memory.py:262` is a naive
  word-set overlap > 0.7. Memories like "User prefers concise answers"
  and "User likes lengthy answers" can be flagged as duplicates because
  the words "user", "answers" overlap.
- **LOW-3** `advisor_info_api.py:32-34` prints to stdout on every load
  and re-reads the Excel sheet from disk on every request — no
  caching.
- **LOW-4** `App.jsx:1` and `ChatMemoryPage.jsx`/`ChatPanel.jsx` import
  `React` as default even though Vite's automatic JSX transform doesn't
  need it. Cosmetic.
- **LOW-5** `App.jsx:30-73` runs an infinite `requestAnimationFrame`
  even when the SignInPage is not in the viewport / off-screen. CPU
  usage during sign-in only, but unnecessary.
- **LOW-6** `MobileBlocker` uses a simple width breakpoint of 750px,
  not media query — won't react to orientation/zoom in some cases.

### Architectural mistakes

- **ARCH-1** `QuotifyHome.jsx` is 3,813 lines and contains five
  near-identical parse functions
  (`parseHomeownersFile / parseAutoFile / parseDwellingFile /
  parseBundleFiles / parseCommercialFile`) plus `parseWindFile`. The
  only differences are the form state setter, the manual-fields
  helper, and a few field-shape merges. Each is ~150-300 lines of
  copy-paste. Should be a single `parseFile(insurance_type, files,
  formSetter, mergeFn)` helper.
- **ARCH-2** Five filler APIs (`auto/homeowners/dwelling/bundle/
  commercial _filler_api.py`) are 80% identical: same imports, same
  template-loading logic, same Chromium render block, same
  store-then-respond block. The only material difference is the Jinja
  context dict. Extract a shared `render_quote_pdf(template_path,
  context, insurance_type, client_name_field)` helper. Currently every
  bug fix needs to be made in five places (e.g. the `client_name`
  alias for dwelling/commercial was added by hand to two of them).
- **ARCH-3** Per-insurance-type frontend `<Type>Panel.jsx` files are
  also heavily duplicated. Five panels share a 12-col grid system, a
  `cellN` helper pattern, and identical rendering logic for client +
  agent + payment-plan blocks. Extracting a `<FormSection>` /
  `<FormField>` set would shrink the bundle and remove drift risk.
- **ARCH-4** Two parallel asyncpg pools exist (`backend/core/database.py`
  and `skill_updater/db.py`) talking to the same Postgres. The
  skill_updater pool tracks loop IDs because Streamlit creates fresh
  loops; the backend pool doesn't because uvicorn keeps one loop. The
  two pools cannot be merged today (different deploy targets) but
  schema migrations are scattered across `database.py:init_db` (CREATE
  TABLE IF NOT EXISTS in code) and
  `skill_updater/migrations/001_skill_updater.sql` (raw SQL). Adopting
  one migration tool (Alembic or yoyo) for both halves would prevent
  drift.
- **ARCH-5** No migration framework — `database.py:init_db` uses
  `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`. This
  pattern works but offers no versioning, no rollback, and no way to
  represent destructive changes. Plan for Alembic (or equivalent) when
  the next non-additive schema change comes up.
- **ARCH-6** `_jwks_cache`, `_skill_cache`, `_sessions` (chat),
  `_SYSTEM_CACHE_REGISTRY`, `_pool` are all process-local module
  globals. Multi-worker uvicorn means N copies of each. Acceptable
  for now (Railway runs a single worker per service) but locks us
  into single-worker deploys until a Redis-backed cache is added.
- **ARCH-7** Sensitive client PDFs are stored as BYTEA in Postgres
  (`pdf_documents.file_data`). Cheap to reach but expensive when the
  table grows — and it can't be cold-stored. S3 + DB metadata is the
  conventional path; postpone until storage cost or query latency
  becomes the bottleneck.
- **ARCH-8** `INSURANCE_TYPE_KNOWLEDGE` in `chat_api.py:74-92` is a
  hardcoded string listing which types are active/beta/coming-soon.
  This duplicates information that already lives in
  `frontend/src/configs/insuranceOptions.js` and the SKILL.md set.
  Easy to drift; centralize.
- **ARCH-9** `analytics_events.uploaded_pdf` is a comma-separated
  string of filenames rather than a foreign-key array to
  `pdf_documents.id`. The chatbot already filters with
  `WHERE uploaded_pdf != ''` (chat_api.py:154); a structured link
  would let `JOIN` work and make the bundle "two PDFs" case explicit.
- **ARCH-10** Many endpoints depend on `get_current_user` but use
  `_user: dict = Depends(...)` (underscore prefix) without consulting
  the value. This works but masks intent. Either use it (e.g. for
  per-user filtering) or document why "any authenticated user" is the
  policy.

---

---

## 9b · Audit log + Design 3 dispatch (post-fix additions)

Two new pieces of infrastructure landed alongside the audit fixes:

### `analytics_events.action` column

Records what kind of event a row represents. Backed by the
`action TEXT NOT NULL DEFAULT 'parse'` column + index, written by
`log_event(..., action=...)`. Allowed values:

- `parse` (default) — extraction completed.
- `generate` — quote PDF was generated and downloaded.
- `download` — an existing stored PDF was downloaded.
- `delete` / `delete_all` — admin removed PDF(s).
- `login` / `logout` — user signed in/out.

The frontend's `trackEvent({...action})` and the convenience wrappers
`trackLogin` / `trackLogout` send these. `track_api.py` validates
against `_ALLOWED_ACTIONS`. `pdf_storage_api.download_document` /
`delete_document` / `clear_all_documents` log `download` /
`delete` / `delete_all` rows automatically. `App.jsx` fires `login`
once per app-mount (ref-guarded against React strict-mode double-fire).

### `analytics_events.system_design` column + skill_updater dispatch

Records which parser orchestration version produced each event
(e.g. `"fitz-fastpath-2026-04-30"`). Set by the frontend via
`SYSTEM_DESIGN_VERSION` from `lib/devMetrics.js`. Backed by the
`system_design TEXT NOT NULL DEFAULT ''` column + index.

`skill_updater` reads this column and dispatches each event to the
matching analyzer:

- `"fitz-fastpath-2026-04-30"` → `analyzer_design3.py` (text-vs-text
  via the duplicated `_fitz_fastpath.py`). On `InadequateTextError`,
  falls back to the vision analyzer for that one event and records
  `error_message='design3_fallback_to_vision: …'` so the fallback
  rate is auditable.
- Any other non-empty string (`"single-pass-cached-2026-04-21"`,
  future tags, etc.) → `analyzer.py` (vision-based, unchanged).
- Empty string → skipped with `outcome='design_unknown'` (pre-migration
  rows; we don't guess which design ran).

Reverting production back to Design 2 doesn't require a skill_updater
code change — events tagged with the older version automatically
route to the vision analyzer.

`skill_updater/app.py section_run` shows a per-design breakdown above
the slider so you can see how the queue splits.

---

## 10 · Skill / prompt files

Don't grep the codebase for prompts — most skill text is in:

- `backend/parsers/skills/parse_<type>/SKILL.md` (extraction skills)
- `backend/skills/*.md` (chatbot reasoning skills, scoped admin/advisor)
- `skill_updater/prompts/*.md` (the analyzer + synthesizer LLM prompts)

The CORE_SYSTEM_PROMPT and TEXT_MODE_CONFIDENCE_RUBRIC live inline in
`unified_parser_api.py` — they're stable and rarely change.

---

## 11 · Local development

Backend:
```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend:
```
cd frontend
npm install
npm run dev    # → http://localhost:5173
```

Required env (backend `.env`):
- `DATABASE_URL` (or `DATABASE_PUBLIC_URL`)
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` (use `pk_test_*`/`sk_test_*` for
  dev, `pk_live_*`/`sk_live_*` for prod — same code path either way; see
  [`auth._get_clerk_config`](backend/core/auth.py))
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (only for report email path)
- `DEV_METRICS_API_KEY` (only if you want the GET /data viewer to work)

Frontend `.env`:
- `VITE_API_BASE_URL` (defaults to `http://localhost:8000`)
- `VITE_CLERK_PUBLISHABLE_KEY` — must match the BACKEND's
  `CLERK_PUBLISHABLE_KEY` (same prefix and same Clerk instance). A
  mismatch makes the JWT `iss` claim fail validation and every
  authenticated request 401s.

### Switching Clerk dev → prod

1. In the Clerk dashboard, copy the production `pk_live_…` and `sk_live_…`.
2. Update **all four** env vars (Railway: backend `CLERK_PUBLISHABLE_KEY` +
   `CLERK_SECRET_KEY`; Vercel: frontend `VITE_CLERK_PUBLISHABLE_KEY`).
3. Restart the backend so the JWKS cache (in-memory) clears and
   `_get_clerk_config` re-derives the new issuer/JWKS URL.
4. Confirm Railway logs show `[clerk] live mode  api=clerk.<your-domain>
   iss=https://clerk.<your-domain>` on the next request.
5. Sign in on the live site and check at least one parse + generate.

Skill_updater:
```
cd skill_updater
pip install -r requirements.txt
streamlit run app.py
```
