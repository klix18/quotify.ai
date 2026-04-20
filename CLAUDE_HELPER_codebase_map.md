# CLAUDE HELPER — Quotify AI Codebase Map & Cleanup Notes

Prepared during a 4-pass cleanup review. Scope: debugging + straggler code only
(no refactors, no architecture changes).

---

## 1. High-level structure

```
quotify-ai/
├── backend/                    FastAPI app (main.py)
│   ├── main.py                 app + router mounts + lifespan (browser, DB, auto-clear task)
│   ├── auth.py                 Clerk JWT → user payload (verify_clerk_token / get_current_user / require_admin)
│   ├── database.py             asyncpg pool, PDFs, analytics, chat_memory, api_usage, settings
│   ├── chat_memory.py          3-layer memory (in-mem session / DB session summary / DB long-term)
│   ├── chat_api.py             Snappy analytics chatbot SSE endpoint + session + memory management
│   ├── analytics_api.py        Admin analytics endpoints (totals, leaderboards, timeline, per-user)
│   ├── report_generator.py     Periodic Resend-sent HTML report (Gemini-generated)
│   ├── settings_api.py         Admin auto-clear setting + api-usage endpoints
│   ├── track_api.py            POST /api/track-event — analytics event logger
│   ├── pdf_storage_api.py      List / download / delete stored PDFs
│   ├── pdf_storage_helpers.py  store_uploaded_pdf / store_generated_pdf (await store_pdf(...))
│   ├── clerk_users_api.py      Admin user role management via Clerk API
│   ├── advisor_info_api.py     Reads advisor Excel sheet → /api/advisors
│   ├── auto_clear_task.py      Background loop that clears PDFs on schedule
│   ├── browser_manager.py      Playwright Chromium singleton (for PDF rendering)
│   ├── pdf_optimizer.py        qpdf lossless PDF optimizer (post Chromium render)
│   ├── usage_tracker.py        Fire-and-forget token usage logger (Gemini + OpenAI)
│   ├── why_selected_generator.py  2-pass "Why this plan?" bullets (Gemini)
│   ├── parsers/
│   │   ├── unified_parser_api.py   Single POST /api/parse-quote endpoint; 3-pass pipeline
│   │   ├── schema_registry.py      JSON schemas + keys for all insurance types
│   │   ├── skill_loader.py         Loads base .md + carrier patch (+ @include resolution)
│   │   ├── carrier_detector.py     Vision pass to identify carrier from logo
│   │   ├── post_process.py         Schema-driven default filling + confidence flattening
│   │   ├── _model_fallback.py      Gemini model-chain fallback + OpenAI cross-provider failover
│   │   ├── _openai_fallback.py     OpenAI Responses API streaming/gen fallback path
│   │   └── skills/*.md             Prompt skills per insurance type (+ carrier sub-dirs)
│   ├── fillers/                Five near-identical PDF generators (one per insurance type)
│   │   └── *_filler_api.py     Jinja2 → Chromium PDF → qpdf → DB store
│   ├── skills/                 Analytics chatbot skill markdown (admin + advisor scope)
│   ├── templates/              Jinja2 + CSS for quote PDFs
│   ├── fonts/                  Custom fonts for PDF rendering
│   └── requirements.txt
│
└── frontend/                   Vite + React 19 + Clerk
    └── src/
        ├── main.jsx            Bootstraps ClerkProvider + BrowserRouter + <App/>
        ├── App.jsx             SignInPage, TopNav, AuthenticatedApp, MobileBlocker
        ├── QuotifyHome.jsx     Main quote workflow UI (3363 lines)
        ├── AdminDashboard.jsx  Admin analytics dashboard (2314 lines)
        ├── ChatPanel.jsx       Snappy chat panel (SSE consumer)
        ├── ChatMemoryPage.jsx  Admin-only memory inspector
        ├── colors.js           COLORS + INSURANCE_COLORS palettes
        ├── trackEvent.js       trackEvent() + getManualFieldNames()
        ├── sparkleFlow.js      Visual "sparkle" animation helper
        ├── panels/             Per-type form panels (Homeowners, Auto, Dwelling, Bundle, Commercial)
        └── configs/            Per-type field constants used by the panels
```

---

## 2. Data flow — parsing pipeline

1. **Frontend** uploads PDF to `POST /api/parse-quote?insurance_type=<type>`.
2. **unified_parser_api.stream_unified_quote** yields ndjson events:
   - `skill_loaded` — from `skill_loader.load_skill(...)`
   - `status` → PDF uploaded via `upload_with_retry`
   - `carrier_detected` — `carrier_detector.detect_carrier(...)` (Pass 0, vision)
   - `draft_patch*` — Pass 1 quick key:value extraction (`stream_with_fallback`)
   - `final_patch*` — Pass 2 schema-enforced JSON (`stream_with_fallback` + `response_schema`)
   - `healing_patch*` — Pass 3 re-check of low-confidence fields (`generate_with_fallback`)
   - `result` — final post-processed data + flattened confidence
3. Model-chain fallback: Gemini flash-lite → flash → flash-2.0 → flash-1.5 → OpenAI fallback chain
   (gpt-4o-mini → gpt-4o). OpenAI path handled by `_openai_fallback.py`.
4. `post_process.post_process(...)` fills defaults from JSON schema (generic — no per-type
   normalizers) and flattens the confidence dict for the UI.

## 3. Data flow — quote PDF generation

1. **Frontend** POSTs the edited quote object to `/api/generate-<type>-quote`.
2. **fillers/<type>_filler_api.py** renders a Jinja2 template → saves HTML to a tmp file in
   the templates directory so Chromium resolves `assets/` and `fonts/` via `file://`.
3. `browser_manager.get_browser()` returns the singleton Chromium; `page.pdf(...)` writes to disk.
4. `pdf_optimizer.optimize_pdf(path)` runs `qpdf` for lossless compression + linearization.
5. `pdf_storage_helpers.store_generated_pdf(...)` saves to Postgres, then the file is streamed
   back as the HTTP response.

## 4. Analytics + chatbot data flow

- Every completed workflow hits `POST /api/track-event` → `database.log_event(...)`.
- `analytics_api.py` serves admin dashboards from `analytics_events`.
- `chat_api.py` drives Snappy (SSE streamed) using `chat_memory` (3 layers) + `skills/*.md`.
- `report_generator.py` assembles data, asks Gemini to produce HTML, and sends via Resend.

---

## 5. Cleanup candidates (Run 1 findings)

> All items below are "debugging + straggler code" per user scope. No refactors.

### BUGS

- **backend/parsers/unified_parser_api.py:647** — Double bug in `store_uploaded_pdf` call.
  The function is `async` (needs `await`) AND it expects `file_data: bytes` but is being
  passed a `Path` object. Currently produces a "coroutine was never awaited" warning
  and the uploaded PDF is never actually persisted to the DB.
  ```python
  # Current (broken):
  store_uploaded_pdf(pdf_path, file.filename or "upload.pdf", insurance_type)
  # Fix:
  await store_uploaded_pdf(
      file_data=pdf_path.read_bytes(),
      file_name=file.filename or "upload.pdf",
      insurance_type=insurance_type,
  )
  ```

### UNUSED IMPORTS — backend

- `backend/auth.py:13` — `Depends` (fastapi)
- `backend/chat_memory.py:10` — `timedelta`
- `backend/database.py:8` — `datetime`
- `backend/analytics_api.py:8` — `Body`
- `backend/skills/__init__.py:7` — `os`
- `backend/parsers/_model_fallback.py:32` — `logging` (file prints directly to stderr)

### UNUSED IMPORTS — frontend

- `frontend/src/ChatPanel.jsx:1` — default `React` (only named hooks are used; Vite's
  automatic JSX transform does not require `React` in scope)
- `frontend/src/ChatMemoryPage.jsx:1` — default `React` (same reason)
- `frontend/src/panels/DwellingPanel.jsx:1` — `DWELLING_PROPERTY_INFO_FIELDS`,
  `DWELLING_NA_FIELDS` (imported, never referenced)

---

## 6. Files intentionally left alone (per user instruction)

- `frontend/public/fonts/*` — user said "leave it alone, dw about it".
- All filler_api files share nearly identical structure (Jinja2 → Chromium → qpdf → DB)
  but the user said "no big changes". A shared helper would be nice but is out of scope.
- Template / skill .md content — not touched.
- Any logic changes, including behavior-preserving refactors.

---

## 7. Run 2 — Marked edits (file : line : before → after)

### BUG FIX

**E1. `backend/parsers/unified_parser_api.py:647`** — await the async call AND
pass bytes instead of Path:
```python
# BEFORE
store_uploaded_pdf(pdf_path, file.filename or "upload.pdf", insurance_type)

# AFTER
try:
    await store_uploaded_pdf(
        file_data=pdf_path.read_bytes(),
        file_name=file.filename or "upload.pdf",
        insurance_type=insurance_type,
    )
except Exception:
    # Persisting the uploaded PDF is best-effort; a DB hiccup must not
    # fail the extraction request (mirrors how generated PDFs are stored
    # in fillers/*_filler_api.py).
    pass
```

### UNUSED IMPORT REMOVALS — backend

**E2. `backend/auth.py:13`** — remove `Depends`:
```python
# BEFORE
from fastapi import Depends, HTTPException, Request, status
# AFTER
from fastapi import HTTPException, Request, status
```

**E3. `backend/chat_memory.py:10`** — drop `timedelta`:
```python
# BEFORE
from datetime import datetime, timedelta, timezone
# AFTER
from datetime import datetime, timezone
```

**E4. `backend/database.py:8`** — drop `from datetime import datetime` entirely:
```python
# BEFORE
import os
from datetime import datetime
from typing import Optional
# AFTER
import os
from typing import Optional
```

**E5. `backend/analytics_api.py:8`** — drop `Body`:
```python
# BEFORE
from fastapi import APIRouter, Body, Depends, Query
# AFTER
from fastapi import APIRouter, Depends, Query
```

**E6. `backend/skills/__init__.py:7`** — drop `import os`:
```python
# BEFORE
import os
from pathlib import Path
# AFTER
from pathlib import Path
```

**E7. `backend/parsers/_model_fallback.py:32`** — drop `import logging`:
```python
# BEFORE
import logging
import sys
import time
# AFTER
import sys
import time
```

### UNUSED IMPORT REMOVALS — frontend

**E8. `frontend/src/ChatPanel.jsx:1`** — drop default `React` (Vite + automatic JSX transform):
```jsx
// BEFORE
import React, { useState, useEffect, useRef, useCallback } from "react";
// AFTER
import { useState, useEffect, useRef, useCallback } from "react";
```

**E9. `frontend/src/ChatMemoryPage.jsx:1`** — drop default `React`:
```jsx
// BEFORE
import React, { useState, useEffect } from "react";
// AFTER
import { useState, useEffect } from "react";
```

**E10. `frontend/src/panels/DwellingPanel.jsx:1`** — drop two unused named imports:
```jsx
// BEFORE
import {
  DWELLING_POLICY_FIELDS,
  DWELLING_CLIENT_FIELDS,
  DWELLING_AGENT_FIELDS,
  DWELLING_PROPERTY_INFO_FIELDS,
  DWELLING_COVERAGE_FIELDS,
  DWELLING_LOSS_SETTLEMENT_OPTIONS,
  DWELLING_NA_FIELDS,
  DWELLING_DEDUCTIBLE_FIELDS_V1,
  DWELLING_DEDUCTIBLE_FIELDS_V2,
  DWELLING_PAYMENT_PLAN_TYPES,
  dwellingFieldsForPaymentPlan,
  POLICY_FORM_OPTIONS,
  CONSTRUCTION_TYPE_OPTIONS,
} from "../configs/dwellingConfig";
// AFTER — DWELLING_PROPERTY_INFO_FIELDS and DWELLING_NA_FIELDS removed
import {
  DWELLING_POLICY_FIELDS,
  DWELLING_CLIENT_FIELDS,
  DWELLING_AGENT_FIELDS,
  DWELLING_COVERAGE_FIELDS,
  DWELLING_LOSS_SETTLEMENT_OPTIONS,
  DWELLING_DEDUCTIBLE_FIELDS_V1,
  DWELLING_DEDUCTIBLE_FIELDS_V2,
  DWELLING_PAYMENT_PLAN_TYPES,
  dwellingFieldsForPaymentPlan,
  POLICY_FORM_OPTIONS,
  CONSTRUCTION_TYPE_OPTIONS,
} from "../configs/dwellingConfig";
```

---

## 7b. Product/UX change log (post-cleanup)

This section records product-level changes applied on top of the base cleanup
pass. Whenever you touch quotify-ai, update this log so future work has an
accurate picture of current behavior.

### Upload dropzone (QuotifyHome.jsx)

- Combined-mode dropzone title is "Drag & drop combined PDF" for
  bundle/homeowners/dwelling (previously plain "Drag & drop PDF").
- Subtitle is per-insurance-type:
  - bundle → "PDF only · single combined home & auto · up to 200MB"
  - homeowners → "PDF only · single combined home & wind · up to 200MB"
  - dwelling → "PDF only · single combined dwelling & auto · up to 200MB"
  - other types → default generic subtitle.
- Wind-file dropzones use `/i-wind.png` icon (`<img src="/i-wind.png" ... />`
  at 18×18) instead of the old 🌀 emoji span. Swapped in two locations:
  homeowners-separate and dwelling-separate modes.

### Right-panel field layouts (12-col grid)

All right-panel sections now fill the full width on every row — no more
ragged last rows. When a section's field count isn't divisible by 3, the
last row expands so cells still sum to 12 columns.

- **Auto Policy** (`AutoPanel.jsx`): 5 fields → first 3 span 4, last 2 span
  6 each (remainder-aware `span = 12 / remainder`).
- **Payment Plans** (auto, bundle, dwelling): Full Pay subcard spans 12
  (single field); installment subcards span 4 each (3 fields × span 4).
- **Dwelling Policy** (`DwellingPanel.jsx`): now 4 fields (see Paid-in-Full
  restructure below) → 2 rows of 2-ish / actually span-3 style; uses `cell4`
  mapping to stay consistent with other 4-field sections.
- **Coverages** (`DwellingPanel.jsx`): 14 fields with remainder-aware
  last-row expansion so the final row fills the grid.
- **Deductible Type 1**: 2 fields span 6 each.
- **Deductible Type 2**: 1 field spans 12.
- **Commercial / Homeowners**: already row-balanced via explicit per-cell
  span configs in their respective config files; untouched.

### Payment Options PDF — empty-state hide (auto / bundle / dwelling)

All three quote templates now wrap the entire final "Payment Options" page
(including heading + subtitle + grid) in a compound Jinja guard so an empty
`payment_options` / `payment_plans` skeleton hides the whole section. The
guard checks both legacy field names (`amount_due`, `installment_details`,
`installment_fee`) and new names (`down_payment`, `amount_per_installment`,
`number_of_installments`). Auto and dwelling also include a
`paid_in_full_discount` clause in the guard so the page still renders when
only the discount block has data.

### Dwelling PDF — consolidated Property protection block

`backend/templates/dwelling/dwelling_quote.html` previously had THREE
sub-sections on each property page:
1. Coverage grid (Dwelling / Other Structures / Personal Property / Fair
   Rental Value) — `coverage-grid` + `cov-card` styling.
2. Liability Protection heading + `liab-card` rows (Premises Liability,
   Medical Payments).
3. Other Details heading + `other-container` rows (settlements, deductibles,
   water backup, ordinance, etc.).

These are now a **single `other-container` "Other Details"-style list**
with one `other-entry` per field. The section heading/subtitle and the
Liability Protection heading/subtitle are gone — everything flows under the
per-property "Protection Details" heading in one visual block. This lets
one property fit on one page.

### Dwelling Paid-in-Full Discount restructure (matches Auto pattern)

Previously, Dwelling Policy S1 in the right panel had two stray fields:
`pay_in_full_discount` and `total_if_paid_in_full`. Those are **removed**.
A new toggleable Paid-in-Full Discount block lives on the Payment Plans
section instead, mirroring the Auto panel exactly.

Changes:
- `frontend/src/configs/dwellingConfig.js`:
  - `DWELLING_POLICY_FIELDS` trimmed from 6 → 4 fields.
  - `EMPTY_DWELLING_FORM` no longer has top-level `pay_in_full_discount`
    / `total_if_paid_in_full`.
  - `payment_plans` skeleton now includes `show_paid_in_full_discount:
    false` and `paid_in_full_discount: {gross_premium, discount_amount,
    net_pay_in_full}`.
  - New export `DWELLING_PAID_IN_FULL_DISCOUNT_FIELDS` (same 3 fields as
    `PAID_IN_FULL_DISCOUNT_FIELDS` in autoConfig).
- `frontend/src/panels/DwellingPanel.jsx`:
  - Imports `DWELLING_PAID_IN_FULL_DISCOUNT_FIELDS`.
  - Receives new prop `onTogglePaidInFullDiscount`.
  - Payment Plans SectionCard gets an `action` "+ Add Paid-in-Full Discount"
    button when hidden; renders a `SubCard` with Remove action when shown.
  - Paid-in-Full field edits reuse `onPaymentPlanChange` with a synthetic
    planKey of `"paid_in_full_discount"`.
- `frontend/src/QuotifyHome.jsx`:
  - New handler `toggleDwellingPaidInFullDiscount` (same shape as
    `togglePaidInFullDiscount` / `toggleBundlePaidInFullDiscount`).
  - Passed to `<DwellingPanel>` as `onTogglePaidInFullDiscount`.
  - `deepMergeDwellingForm` auto-reveals
    `show_paid_in_full_discount = true` when any PIF field is populated by
    the AI (parity with auto/bundle). Legacy `premium_summary` mapping no
    longer writes `pay_in_full_discount` / `total_if_paid_in_full` top-level
    fields (they no longer exist on the form).
- `backend/templates/dwelling/dwelling_quote.html`:
  - `_has_payment_plans` guard now includes a
    `show_paid_in_full_discount + paid_in_full_discount.*` clause.
  - After the payment-grid, new "Paid-in-Full Discount" `other-container`
    block (gross premium, discount amount, net pay-in-full) — matches the
    auto template's structure exactly.

### Payment Options PDF — split guard for PIF-only rendering (auto + dwelling)

Regression: when a Dwelling quote had **only** the Paid-in-Full Discount
filled in (no `full_pay`/`two_pay`/`four_pay`/`monthly` plan data), the PDF
still rendered the "Payment Options" section-heading plus the subtitle
"Available payment plans for this dwelling policy." above an empty grid,
followed by the PIF block. The subtitle was misleading because no payment
plan cards existed.

Fix: the single `_has_payment_plans` guard in both `auto_quote.html` and
`dwelling_quote.html` is now split into two independent guards:

- `_has_plans` — true when at least one real installment plan has data.
- `_has_pif`  — true when `show_paid_in_full_discount` is on AND at least
  one of `gross_premium` / `discount_amount` / `net_pay_in_full` is set.

The page wrapper renders when EITHER is true. Inside the page:
- "Payment Options" heading + "Available payment plans…" subtitle +
  `payment-grid` render only under `{% if _has_plans %}`.
- "Paid-in-Full Discount" now has its own heading **and** a new subtitle
  ("Savings available when paying the full premium up front."), rendered
  under `{% if _has_pif %}`. The heading was promoted from a stand-alone
  sub-heading to a proper section-heading-with-subtitle to match the
  visual weight of "Payment Options" so a PIF-only page doesn't look
  orphaned.

Bundle (`bundle_quote.html`) was NOT changed — it has no Paid-in-Full
Discount block in the template, so its existing `_has_payment_plans` guard
is already correct (only triggers when a real plan has data).

### Dwelling/Commercial PDF — `client_name` alias for Client Information

Regression: the Client Information block in `base.html` renders
`{{ client_name }}`, but `dwelling_filler_api.py` and
`commercial_filler_api.py` only set `named_insured` on the Jinja context
(their canonical field name). Result: the Name row printed blank for
dwelling and commercial PDFs even when a client name was entered.

Fix in both fillers:
- `dwelling_filler_api.py` now also sets `"client_name": data.get("named_insured", "") or data.get("client_name", "")`.
- `commercial_filler_api.py` applies the same `client_name` alias, plus a
  `client_address` alias for `mailing_address` (commercial's canonical
  address field).

Auto / bundle / homeowners fillers already pass `client_name` and were
unaffected. No template changes were required — the fix is purely a
context-key alias.

### Dwelling Property Details — brand-compliant 2-section layout

First pass used custom `.dw-*` classes with multiple background colors
(white+blue border, `#E8EFF8`, `#F7F7F7`, dark blue gradient) and
small-caps Poppins section labels. Flagged as brand-non-compliant — the
brand guide is the 7-font type system in `base.html` lines 85-96, and
cards must be `#F2F2F2` only.

Revised layout drops all `.dw-*` classes and the
`{% block extra_styles %}` block entirely. Layout variety now comes from
contrasting two existing brand patterns (both on `#F2F2F2`):

1. **Coverage & Liability Limits** — `.coverage-grid` with 6 `.cov-card`s
   in a 2×3 grid. Uses `.cov-name` (Poppins 600 15px #0451BD),
   `.cov-value` (Poppins 400 15px #0451BD), `.cov-desc` (Poppins 400
   11px #20272D). Items: Dwelling, Other Structures, Personal Property,
   Fair Rental Value, Premises Liability, Medical Payments.
2. **Policy Terms, Endorsements & Deductibles** — `.other-container`
   with stacked `.other-entry` rows. Same `.other-name` / `.other-val` /
   `.other-desc` typography. Items: Dwelling Loss Settlement, Personal
   Property Settlement, Water Backup, Ordinance or Law, Extended
   Replacement Cost, All Other Perils Deductible, Wind/Hail Deductible,
   Combined Deductible.

Both section headers are `.section-heading.sentient` (Sentient 400 28px
#20272D) with a Poppins 400 13px `.section-sub` subtitle — identical
treatment to "Paid-in-Full Discount" on the Payment Options page. Every
variable has a 1-line `.cov-desc` / `.other-desc` description so the
reader never sees a bare label+value pair.

Combined Deductible has a conditional guard
(`{% if property.deductible and not property.aop_deductible and not
property.wind_hail_deductible %}`) because it is semantically the same
thing as AOP + Wind/Hail merged; showing all three would be redundant
and would also overflow the page.

Sections render only when at least one of their fields has data
(`_has_limits`, `_has_terms` guards), so a sparse property still lays
out cleanly. Inline margin tightening
(`section-heading margin-top: 10px`, `section-sub margin-bottom: 8px`)
is scoped to the dwelling Property Details page only and doesn't alter
base.html.

Per-coverage premium fields (`personal_property_premium`,
`premises_liability_premium`, `water_backup_premium`) are intentionally
NOT rendered — they are internal/underwriting detail. The total premium
is already on the cover page.

### `.cov-header` gap tightened — base.html (2026-04-19)

Reduced `.cov-header { margin-bottom }` in `base.html` from 5px → 2px so
the blue `.cov-name` / `.cov-value` row sits tighter against the black
`.cov-desc` description inside every `.cov-card`. Change is in base only
(propagates to homeowners / bundle / dwelling / commercial / auto
templates automatically via the shared class).

The five `_preview/*.html` files duplicate the entire base CSS inline
(they're standalone browser-preview sandboxes, not rendered at runtime
by `report_generator.py` or the fillers). They were updated in parallel
so the previews don't drift from the live PDF output. **Drift risk:** any
future base.html style change needs the same parallel edit in
`_preview/*.html` — or the `_preview` files should eventually be
refactored to `{% extends "base.html" %}` (or deleted, since nothing
references them). Flagged but not acted on in this pass.

### Dwelling — removed two `.section-sub` subtitles (2026-04-19)

Deleted these two subtitles from `dwelling_quote.html` only (left
alone in auto / bundle / commercial / homeowners):
- "Dollar limits that define how much the policy will pay in each area."
- "Settlement methods, optional endorsements, and out-of-pocket costs
  at time of loss."

To compensate for the lost vertical rhythm from the missing subtitle,
the matching `.section-heading` got `margin-bottom: 2px → 8px`.

### Payment plans — schema migration fix (dwelling + bundle, 2026-04-19)

Root cause: the UI form writes the new field schema
(`full_pay_amount` / `down_payment` / `amount_per_installment` /
`number_of_installments`) but dwelling + bundle templates were still
guarding on the legacy `amount_due` / `down_payment` fields. Net effect:
the outer `_has_plans` guard passed (it already accepted both schemas),
so the "Payment Options" heading and subtitle rendered — but every
inner card check failed, leaving the grid empty.

Fix applied to **`dwelling/dwelling_quote.html`** and
**`bundle/bundle_quote.html`**:
- Full Pay guard + render: `full_pay_amount or down_payment` (bundle)
  / `full_pay_amount or amount_due` (dwelling). Label is "Full Payment"
  (bundle) / "Full Pay Amount" (dwelling).
- Installment cards (2-Pay/4-Pay/Monthly for dwelling,
  Semi-Annual/Quarterly/Monthly for bundle): each row wrapped in
  `{% if field %}` so only populated fields render; `number_of_installments`
  added to both the outer `_has_plans` guard and the per-card render.
- **`auto/auto_quote.html`** was already correct (no edit needed) —
  it was the reference pattern.

Match the auto template's pattern (`full_pay_amount or down_payment`)
for any future schema migrations on these templates.

### Bundle separate-mode parse fixes (2026-04-19)

Three related bugs on the Bundle separate-mode upload flow:

1. **`POST /api/parse-quote?insurance_type=bundle` returned 422.** The
   frontend was sending both PDFs under a repeated `files` field, but the
   FastAPI endpoint expected `file: UploadFile` (singular). Combined mode
   had the same latent bug — it also sent a single PDF under `files`.

   Fix: added a new optional `secondary_file: UploadFile | None` parameter
   to `parse_quote` in `backend/parsers/unified_parser_api.py`. The
   frontend's `parseBundleFiles` now sends the first PDF as `file` and the
   second (when present) as `secondary_file`. `stream_unified_quote`
   threads `secondary_pdf_path` through like `wind_pdf_path`, attaches it
   to all three Gemini calls (quick/final/heal), and cleans it up in the
   `finally` block.

2. **`[object Object]` shown instead of an error message.** When FastAPI
   returns a 422, the response body is
   `{"detail": [{"loc": [...], "msg": "...", ...}]}` — `detail` is a
   list of validation-error objects, not a string. All six parse error
   handlers (homeowners / auto / dwelling / bundle / commercial / wind)
   used `payload?.detail || fallback`, which stringified the array to
   `[object Object]`.

   Fix: added `extractErrorDetail(payload, fallback)` at the top of
   `QuotifyHome.jsx`. It handles string, array-of-objects, and plain-
   object shapes. All six `detail = payload?.detail || detail` lines
   now call the helper. Shows "field required; field required" instead
   of `[object Object]`.

3. **Bundle separate mode required a manual "Parse Both Quotes"
   button.** Homeowners and dwelling separate modes already auto-parse
   via `useEffect` the moment both PDFs are staged. Bundle was the odd
   one out.

   Fix: added a parallel `useEffect` for bundle that fires
   `parseBundleFiles([separateHomeFile, separateAutoFile])` when both
   files are present and not already parsing. Removed the "Parse Both
   Quotes" button from the JSX. All three separate-mode flows now share
   the same pattern (no manual parse button anywhere).

### Bundle separate-mode auto-extraction fix (2026-04-19)

After fixing the 422 / `[object Object]` / auto-parse issues above, the
parse call itself succeeded but the AUTO fields all came back blank
(only homeowners fields were populated). The model was treating both
PDFs as a single combined bundle document and biasing toward PDF #1.

Root cause turned out to be **three compounding issues**, not just
skill content. Fixing only the skill (v1 of this entry) was not enough;
auto still didn't parse. The full fix has three layers:

**Layer 1 — schema-accurate supplement skill.** `bundle.md` uses
`@include homeowners` + `@include auto` and says the input "may be a
single combined document OR two separate PDFs processed together", but
never tells the model which PDF is which. Compare with wind/hail's
`wind_hail.md` supplement, which explicitly states "PDF #1 is primary,
PDF #2 is wind/hail".

- New skill: `backend/parsers/skills/bundle_separate.md` (now v1.1).
  Tells the model exactly "PDF #1 = HOMEOWNERS quote, apply
  homeowners rules; PDF #2 = AUTO quote, apply auto rules", with
  anti-patterns and premium rules.
- **v1.1 rewrite** — v1.0 referenced fabricated fields like
  `auto_full_pay_amount` / `home_policy_term` that don't exist in the
  bundle schema, which confused the model into ignoring large chunks
  of the supplement. v1.1 references only actual schema paths
  (`dwelling`, `payment_options.full_pay.full_pay_amount`, `drivers[]`,
  `vehicles[]`, `coverages{}`, `premium_summary{}`, etc.).
- In `stream_unified_quote` (`backend/parsers/unified_parser_api.py`),
  the skill is loaded when `insurance_type == "bundle"` AND
  `secondary_pdf_path is not None`, then appended to the merged skill
  content with a banner header (parallel to the wind/hail supplement
  block). Non-fatal fallback inlines a terse version if the file is
  missing. Append happens after `load_skill_with_carrier` so the
  supplement is authoritative for PDF ordering.

**Layer 2 — multi-PDF-aware prompt wording.** All three pass prompts
(quick / final / heal) literally said "from this PDF" (singular) even
when 2 PDFs were attached, which biased Gemini to read only PDF #1.

- New helpers in `stream_unified_quote`:
  ```python
  pdf_count = 1 + (1 if uploaded_wind_file else 0) + (1 if uploaded_secondary_file else 0)
  pdf_phrase = "this PDF" if pdf_count == 1 else f"these {pdf_count} PDFs"
  ```
- Pass 1 quick prompt now appends `"(read BOTH documents in order —
  PDF #1 first, PDF #2 second). "` when `pdf_count > 1`.
- Pass 2 final prompt branches on `pdf_count`: single-PDF keeps the
  original wording; multi-PDF switches to `"Extract … from {pdf_phrase}.
  Read BOTH documents — do NOT stop after the first one. PDF #1 is
  attached first; PDF #2 is attached second. Apply the active skill
  (including any separate-mode supplement) to determine which fields
  come from which PDF."`
- Pass 3 healing: `_build_healing_prompt` signature gained a
  `pdf_count: int = 1` parameter; body emits a `doc_phrase` and a
  `multi_doc_hint` (`" (read BOTH documents — the active skill tells
  you which fields come from which PDF)"`) when multi-PDF. Call site
  passes `pdf_count=pdf_count`.

**Layer 3 — labeled text markers interleaved between file parts.** Even
with correct skill + prompt, Gemini's `contents` array was
`[prompt, file1, file2]` — no visible boundary between the two PDFs
inside the content stream. The skill said "PDF #1 is home" but the
model couldn't see where PDF #1 ended and PDF #2 began.

- New helper `_build_contents(prompt)` inside `stream_unified_quote`.
  For `pdf_count > 1` it emits:
  - `"── PDF #1 of 2 (HOMEOWNERS QUOTE) ──"` (bundle-separate) or
    `"── PDF #1 of 2 ({TYPE} QUOTE) ──"` (wind/hail mode)
  - then `uploaded_file`
  - then `"── PDF #2 of 2 (AUTO QUOTE) ──"` (bundle-separate) or
    `"── PDF #2 of 2 (WIND / HAIL QUOTE) ──"` (wind/hail mode)
  - then the secondary/wind file
- Applied uniformly to all three passes: `quick_contents`,
  `final_contents`, `heal_contents` all go through `_build_contents`.
- This gives Gemini an unambiguous visual boundary and matches the
  skill's "PDF #1 / PDF #2" vocabulary.

Net result: bundle separate-mode now extracts both homeowners AND auto
fields. The wind/hail separate-mode flow automatically gets the same
multi-PDF wording + marker treatment (parallel code path in
`_build_contents`) as a bonus.

Still-pending gap at the time of this entry: `_openai_fallback.py`'s
`stream_openai_extraction` only accepted one `pdf_path` and dropped
the secondary/wind file when the Gemini chain failed over to OpenAI.
**Resolved** in the follow-up "Cross-provider fallback multi-PDF +
bundle schema state-limit fix" entry below (2026-04-19).

### Dwelling promoted out of Beta (2026-04-19)

Dwelling is now production-ready, same tier as Homeowners and Auto.
- `frontend/src/configs/insuranceOptions.js` — label changed from
  "Dwelling (Beta)" to "Dwelling".
- `backend/chat_api.py` — `INSURANCE_TYPE_KNOWLEDGE` moved dwelling
  from the BETA section to ACTIVE so Snappy stops describing it as
  "in beta testing".
- `QuotifyHome.jsx:3057` `.replace(" (Beta)", "")` is a no-op for
  dwelling now, but still strips the suffix from Bundle and
  Commercial — leave it in place.
- Remaining Beta tiles: Bundle, Commercial.

### Deductibles — table redesign + page reorg (2026-04-19)

The Deductibles block (auto + bundle templates) previously rendered as
stacked per-vehicle cards: vehicle name → Comprehensive row (label + value
+ description) → Collision row (label + value + description). That worked
but got tall quickly with multiple vehicles and felt disconnected from
the Listed Drivers / Insured Vehicles tables further down the same page.

First pass tried a "chart" look with a custom `.deductibles-table` class
(filled light-blue header, per-column descriptions under each title).
User rejected it — asked for the same style + fonts as the rest of the
tables, and asked for the page order to put Drivers first, Vehicles
second, and Deductibles on its own page after.

Final state:

- `backend/templates/base.html` — no new CSS. The earlier
  `.deductibles-table` class was removed; Deductibles now uses the
  existing `.detail-table r8` class shared with Listed Drivers /
  Insured Vehicles.
- `backend/templates/auto/auto_quote.html` — page reorg + conditional
  Deductibles placement:
  - Page 3 heading renamed from "DEDUCTIBLES, DRIVERS & VEHICLES" to
    "DRIVERS & VEHICLES". Page 3 now contains Drivers (colgroup
    35/18/25/22) then Vehicles (colgroup 38/28/14/20), both using
    `.detail-table`.
  - **Deductibles placement rule**: weight =
    `(vehicles|length * 2) + (drivers|length * 1)`.
    - Weight ≤ 11 → Deductibles renders **inline** at the bottom of
      Page 3, right after Vehicles (same `.detail-table r8`, tighter
      `margin-top: 10px` heading since it's continuing a page).
    - Weight > 11 → Deductibles gets its own **Page 4** with the
      full logo + heading + disclaimer treatment
      (`margin-top: 20px` heading).
    - Rationale: each vehicle row consumes more visual weight than a
      driver row because the deductibles table is keyed per-vehicle,
      so vehicles count as 2 and drivers as 1.
    - Jinja: `{% set _vehicle_count = ... %}` /
      `{% set _driver_count = ... %}` /
      `{% set _ded_weight = ... %}` /
      `{% set _ded_on_separate_page = _ded_weight > 11 %}` set at the
      top of Page 3 and reused by both conditional blocks.
  - Both placements share the `{% set _ded_any = namespace(flag=false) %}`
    pre-scan — neither renders when no vehicle has deductible data.
    Table in both cases is `.detail-table r8` with colgroup 50/25/25
    and columns Vehicle / Comprehensive / Collision. No descriptions.
  - Payment Options page renumbered from PAGE 4 to PAGE 5 in the
    comment marker (it's only actually Page 5 when Deductibles takes
    its own page; otherwise Payment Options is effectively Page 4,
    but the comment marker is just a dev-side label).
- `backend/templates/bundle/bundle_quote.html` — full page reorg to
  mirror the auto quote. Final layout:
  - Page 1: Cover (unchanged).
  - Page 2: Homeowners Details (unchanged).
  - Page 3: Auto Coverage Details — Policy Term, Liability Limits,
    Additional Coverages. The old per-vehicle Deductibles block that
    used to live here was removed.
  - Page 4: **Drivers & Vehicles** — identical structure to the auto
    quote's Page 3: Drivers table (colgroup 35/18/25/22), Vehicles
    table (colgroup 38/28/14/20, subtitle "Vehicles covered under
    this policy." — no more "…along with their premium breakdowns"),
    and inline Deductibles (`.detail-table r8`, colgroup 50/25/25)
    when weight ≤ 11. Per-vehicle premium cards are NO LONGER on
    this page.
  - Page 5: **Deductibles (large rosters)** — same standalone page
    as auto's Page 4, only renders when weight > 11.
  - Page 6: **Payment Options & Paid-in-Full Discount** (last page —
    mirrors auto quote's Page 5 exactly). Contains:
      1. Payment Options grid (same structure as auto's Page 5).
      2. Paid-in-Full Discount (`.other-container`, three entries —
         Gross Premium, Discount Amount, Net Pay-in-Full) — **newly
         added to bundle**; was previously only in the auto quote.
    The page is gated on `_has_payment_plans or _has_pif`, and each
    section individually gates on its own data so empty skeletons
    stay hidden. (Example: a bundle with only a PIF and no plans
    will render the last page with just the PIF section.) The
    per-vehicle "Premium Breakdown" cards that used to live on this
    page were removed — the bundle no longer shows Premium Breakdown
    anywhere; the auto portion of a bundle presents exactly like the
    standalone auto quote.
- `backend/templates/_preview/auto_preview.html` — since the preview's
  hardcoded demo data is 1 vehicle + 2 drivers (weight = 4, well under
  11), Deductibles renders **inline** after Vehicles on the demo Page 3
  (before Payment Options). The separate Page 4 block was removed.
  When the dynamic template logic flips to "separate page" for larger
  rosters in production, the preview doesn't need to demonstrate that
  mode — the design is identical, just on a different page.
- `backend/templates/_preview/bundle_preview.html` — rebuilt to match
  the quote template's 5-page structure: Cover / Homeowners / Auto
  Coverage / Drivers+Vehicles+inline Deductibles / Payment Options +
  PIF. Preview demo data is 1 vehicle + 1 driver (weight 3), so
  inline Deductibles is the correct rendering. The old in-page
  Payment Options block that used to share Page 4 with
  Drivers/Vehicles was moved onto Page 5. A PIF example section was
  added to the preview using realistic demo values ($1,396 gross /
  -$40 discount / $1,356 net) so advisors can see the new section.
  The "Premium Breakdown" per-vehicle cards that briefly shared Page
  5 were removed — the preview Page 5 now opens directly with the
  Payment Options heading, and the orphaned
  `.vehicle-premium-card/.vehicle-premium-title/.premium-row*` CSS
  was stripped too.

Verified via Jinja render test across 9 input shapes on both the
auto and bundle templates:
- 2 cars + 1 driver = 5 → inline ✓
- 5 cars + 2 drivers = 12 → separate page ✓
- 5 cars + 1 driver = 11 → inline (boundary) ✓
- 4 cars + 4 drivers = 12 → separate ✓
- 2 cars, no deductible data → neither block renders ✓
- 6 cars + 0 drivers = 12 → separate ✓
- 3 cars + 5 drivers = 11 → inline (boundary) ✓
- 3 cars + 6 drivers = 12 → separate ✓
- empty vehicles list → neither ✓

All produce the expected output. Grep confirmed no stale references
to `deductibles-table|ded-title|ded-desc|ded-cell` remain in the
templates dir.

### Auto + Bundle panels — 3-per-row grid refactor (2026-04-19)

User asked to tighten the Auto and Bundle panels from 4-per-row to
3-per-row for the Vehicles and Coverages sections. The panels use a
12-col CSS grid (`gridTemplateColumns: "repeat(12, minmax(0, 1fr))"`),
so switching to 3-per-row means `span 4` cells instead of `span 3`.

- `frontend/src/panels/AutoPanel.jsx` — Vehicles section: all four top
  fields (year/make/model/trim, VIN, vehicle use, garaging zip/county)
  changed from `span 3` → `span 4`; the two per-vehicle deductibles
  (Comprehensive, Collision) changed from `span 6` → `span 4`, so all
  six vehicle fields now render as two rows of 3. Coverages section:
  merged the previous slice(0,4)/slice(4,6) split into a single
  `.slice(0, 6)` loop with `span 4` (BI, PD, MedPay, UM/UIM BI, UMPD
  Limit, UMPD Deductible → two rows of 3). The trailing `.slice(6)`
  (Rental, Towing) stays at `span 6` — two items fill the row evenly.
- `frontend/src/panels/BundlePanel.jsx` — Vehicles section: same edit,
  all `cell3` → `cell4` on the four top fields and `cell6` → `cell4`
  on the deductibles. Auto Coverages section consolidated: Policy
  Term + all 8 `BUNDLE_AUTO_COVERAGE_FIELDS` now render with `cell4`
  (9 items total = 3 rows of 3 exactly). Removed the previous
  slice(0,3)/slice(3,6)/slice(6) split since the whole list is uniform
  now.

Cell helpers in `BundlePanel.jsx` (`cell3`/`cell4`/`cell6`) are unchanged
— only which helper gets used changed. No config or schema changes.

### Bundle premium key-mismatch fix (2026-04-19)

User reported that with a Frontline (home) + Dairyland (auto) bundle-separate
parse, premiums came back blank in the UI even though both PDFs show the
values clearly ($3,510.00 home, $2,744.13 auto). Root cause was not a parser
bug — the model was extracting fine — but a **field-name mismatch between
backend and frontend**. The backend schema + skills emitted
`home_total_premium` / `auto_total_premium` / `combined_total_premium`;
the frontend form config (`frontend/src/configs/bundleConfig.js`),
the Jinja PDF template (`backend/templates/bundle/bundle_quote.html`),
and the filler API (`backend/fillers/bundle_filler_api.py`) all read from
`home_premium` / `auto_premium` / `bundle_total_premium`. Extracted values
were written under keys the UI and PDF generator never read, so they
silently disappeared.

Fix: renamed the backend keys to match the frontend's canonical names
(frontend has the wider blast radius — PDF template, filler, form state,
display labels — so renaming frontend would have rippled everywhere).

- `backend/parsers/schema_registry.py::_make_bundle_schema` —
  `home_total_premium` → `home_premium`,
  `auto_total_premium` → `auto_premium`,
  `combined_total_premium` → `bundle_total_premium`. Added an inline
  comment warning that these names must stay in sync with the frontend.
- `backend/parsers/skills/bundle.md` — bumped to v1.1; all quick-pass
  field list entries and Bundle-Specific Fields doc entries renamed.
  Also added `bundle_total_premium` to the quick-pass list (was missing).
- `backend/parsers/skills/bundle_separate.md` — bumped to v1.2; all
  premium-field references in the "Premium Fields (schema-exact)"
  section and anti-patterns renamed. Added an explicit rule: when
  PDF #2 is a 6-month auto policy showing "Total 6 Month Premium", use
  that verbatim and do NOT annualize (Dairyland-style layouts have
  both a 6-month total and a 12-month term premium in the same
  document, so the model needs a tie-breaker).

Verified: bundle schema still validates (3484 chars, down 14 from the
pre-rename size), `post_process._fill_defaults_from_schema` fills
`home_premium`, `auto_premium`, `bundle_total_premium`, `bundle_discount`
defaults to `""` as expected, `flatten_confidence` produces the same
dot-path shape the frontend's confidence overlay expects
(`home_premium: 0.95`, etc.).

### Cross-provider fallback multi-PDF + bundle schema state-limit fix (2026-04-19)

A backend debug trace on a bundle-separate parse surfaced two compounding
bugs that together caused auto fields to come back blank even after the
Layer-1/2/3 fixes above:

1. Gemini Pass 2 reliably returned
   `400 INVALID_ARGUMENT: The specified schema produces a constraint that
   has too many states for serving` on the **bundle** `response_schema`
   — forcing every bundle parse to fall through to OpenAI.
2. `_openai_fallback.stream_openai_extraction` accepted only a single
   `pdf_path`; when bundle-separate fell over to OpenAI, the AUTO PDF
   was silently dropped and the model never saw it.

Both were addressed in one pass:

**Fix A — shrink the bundle response schema
(`backend/parsers/schema_registry.py::_make_bundle_schema`).** Gemini's
structured-output validator has an internal state budget per schema; the
bundle schema (homeowners + auto + bundle-specific fields) tripped the
limit. The user-visible output shape is unchanged — we only relaxed the
constraints Gemini's validator enforces:

- Dropped every `enum` (on `replacement_cost_on_contents`,
  `25_extended_replacement_cost`, `policy_term`, driver `gender`, etc.)
  — enums multiply state count.
- Dropped every nested `required` array (drivers, vehicles,
  `coverage_premiums`, `coverages`, `payment_options`,
  `premium_summary`). Only the top-level
  `required: ["client_name", "quote_date", "confidence"]` remains.
- Replaced the mirror-nested confidence block (which duplicated every
  leaf key of the data schema) with `"confidence": {"type": "object"}`.
  Gemini still emits confidence scores — `post_process.flatten_confidence`
  walks whatever shape comes back and flattens it to dot-paths, so the
  frontend contract (`confidence[path] = float`) is preserved.
- Size: bundle schema went from >10 KB (pre-fix) to 3498 chars, smaller
  than even the auto-only schema (8125). Enum count = 0; `required`
  arrays = 1 (top-level only).

Confidence that the wider data-side shape still works:
`post_process._fill_defaults_from_schema` was verified to still fill
every missing property with type-appropriate defaults (scalar → `""`,
array → `[]`, object → `{}`, nested objects recursed) from the relaxed
schema, so downstream consumers (`deepMergeBundleForm` in
`QuotifyHome.jsx`, panel render code) get the same keys as before.

**Fix B — multi-PDF support in the OpenAI fallback
(`backend/parsers/_openai_fallback.py`).** Added two new keyword
arguments to **both** `stream_openai_extraction` and
`generate_openai_extraction`:

- `extra_pdf_paths: Optional[List[Path]] = None` — additional PDFs to
  attach alongside the primary `pdf_path`.
- `pdf_labels: Optional[List[str]] = None` — label strings
  (`[primary_label, extra_1_label, ...]`) interleaved between file
  parts as `input_text` markers, matching the boundary-marker pattern
  the Gemini path uses in `_build_contents`.

New helper `_build_user_content(user_prompt, file_ids, pdf_labels)`
handles the interleaving. Single-PDF case (len==1) stays exactly
`[text, file]` — no markers — so the single-file behavior is
bit-identical to before. Multi-PDF case emits
`[text, marker_1, file_1, marker_2, file_2, ...]`. If
`len(pdf_labels) != len(file_ids)` it defensively falls back to
generic `── PDF #N of M ──` markers.

`generate_openai_extraction` also still handles the text-only case
(`pdf_path=None` — used by the why-selected/report generators) by
skipping `extra_pdf_paths` entirely.

**Call-site updates in `unified_parser_api.py::stream_unified_quote`:**

- Pulled `pdf_labels` and `extra_pdf_paths` out of `_build_contents`
  into outer-scope locals so Pass 1, Pass 2, Pass 3, and both OpenAI
  fallback lambdas all reference the same list.
- Label population mirrors what Gemini sees:
  `[── PDF #1 of 2 (HOMEOWNERS QUOTE) ──, ── PDF #2 of 2 (AUTO QUOTE) ──]`
  for bundle-separate;
  `[── PDF #1 of 2 ({TYPE} QUOTE) ──, ── PDF #2 of 2 (WIND / HAIL QUOTE) ──]`
  for wind/hail; and `[]` for single-PDF mode.
- Both Pass 1 (line ~601) and Pass 2 (line ~672) `openai_fallback=lambda`
  now forward `extra_pdf_paths=extra_pdf_paths, pdf_labels=pdf_labels`.
- Pass 3 healing has no OpenAI fallback (best-effort by design, wrapped
  in `except heal_exc`) but still uses `_build_contents(healing_prompt)`
  for the Gemini side, which reads the same outer-scope `pdf_labels`.

**Net result:** Bundle-separate parses that used to silently lose auto
fields now either succeed on Gemini (schema fits within the state
budget) OR, if Gemini is down, fall over to OpenAI with **both** PDFs
attached and labeled — auto fields populate in both paths.

**Diagnostic logging:** `_log` in `_openai_fallback` now emits
`pdfs={len(file_ids)}` on each stream/gen start so post-mortems can
tell at a glance whether the secondary PDF made it across.

**Verified:** 5-pass sweep covering AST import, call-site audit,
failure-mode walkthrough (single / home+wind / bundle-separate /
3-file edge case / healing / missing-kwargs / label-count mismatch /
schema size), end-to-end signature + `_build_user_content` simulation
with representative inputs, and cross-pollination check against
`wind/hail`, combined-mode, and single-type flows (none affected —
`why_selected_generator`, `report_generator`, `carrier_detector` use
`_model_fallback` not the OpenAI fallback).

---

## 8. Run 3 — Confirmation checklist

Each marked edit must satisfy:
1. The symbol is **truly** unused elsewhere in the file (verified by substring scan
   excluding the import line).
2. Removal does not break public API / module exports.
3. The behavior of the code is unchanged.

| # | File | Line | Symbol | Confirmed unused? | Breaks public API? | Behavior change? |
|---|------|------|--------|-------------------|--------------------|------------------|
| E1 | parsers/unified_parser_api.py | 647 | (bug, not import) | — | no | **yes — now actually persists uploaded PDF** (previously silently dropped). This is the fix. |
| E2 | auth.py | 13 | `Depends` | yes (not referenced anywhere in auth.py) | no | no |
| E3 | chat_memory.py | 10 | `timedelta` | yes | no | no |
| E4 | database.py | 8 | `datetime` | yes (file uses only `uuid4`, `Optional`, `asyncpg`) | no | no |
| E5 | analytics_api.py | 8 | `Body` | yes | no | no |
| E6 | skills/__init__.py | 7 | `os` | yes (file uses `Path` from pathlib) | no | no |
| E7 | parsers/_model_fallback.py | 32 | `logging` | yes (prints via `sys.stderr`) | no | no |
| E8 | ChatPanel.jsx | 1 | default `React` | yes (no `React.*` usage; Vite @vitejs/plugin-react v6 uses automatic JSX transform) | no | no |
| E9 | ChatMemoryPage.jsx | 1 | default `React` | yes (no `React.*` usage) | no | no |
| E10 | panels/DwellingPanel.jsx | 1 | `DWELLING_PROPERTY_INFO_FIELDS`, `DWELLING_NA_FIELDS` | yes (only appear on import line) | no | no |

All confirmed safe. Proceed to Run 4.

---

## 9. Source-of-truth invariants (2026-04-20)

These are load-bearing rules. Any change that touches analytics, user
attribution, or the admin dashboard must preserve them.

### The ONE stable identifier is the Clerk user_id

- `analytics_events.user_id` is the Clerk `sub` claim (format `user_xxxxx`).
- `user_name` is display-only. It can change, collide, be written lowercase,
  be swapped with an email, etc. NEVER use it for identity.
- `track_api.py` rejects JWTs without a `sub` claim (401) so no row can be
  written with user_id=''. This is enforced at the ingress, not just relied
  on downstream.

### The ONE source of truth is analytics_events

- Dashboard totals, leaderboards, timelines, and Snapshot History all derive
  from `analytics_events`. They do NOT read from `pdf_documents` for counts.
- `pdf_documents` mirrors the attribution fields (`user_id`, `user_name`,
  `client_name`) for link-through when viewing a specific snapshot, but is
  not queried for "how many did Kevin generate".
- If you find yourself computing a number from `pdf_documents` that ALSO
  exists in `analytics_events`, stop and use the analytics_events value.

### Legacy rows are consolidated on startup via user_id_backfill.py

- `backend/user_id_backfill.py` fetches Clerk users and bulk-UPDATEs rows
  with `user_id=''` when `user_name` matches any alias (fullName, first,
  last, email, email-local-part; case-insensitive fallback).
- Runs on `main.py` lifespan startup AND is exposed as admin endpoint
  `POST /api/admin/analytics/backfill-clerk-ids` for manual re-runs.
- The UPDATE is gated by `user_id IS NULL OR user_id = ''` so it can NEVER
  overwrite an existing attribution. Safe to run repeatedly.

### Frontend aggregates by user_id, not user_name

- `AdminDashboard.jsx` `UserTable` keys the merge map by resolved Clerk id
  (`byClerkId[clerkId]`), summing counts across any fragments the backend
  returned. The old `analyticsMap[u.user_name] = u` pattern is GONE — it
  caused silent collisions that dropped Kevin Li's count to 1.
- `clerkUsers` alias map now indexes by Clerk id as well, so the UserRow
  lookup can resolve role/avatar directly from `u.user_id`.
- Orphan rows (activity with no matching Clerk account) are shown rather
  than silently filtered out — the admin must explicitly delete them via
  the event-level delete flow if they are genuinely stale.

### trackEvent must be awaited

- `frontend/src/trackEvent.js` uses `keepalive: true` AND checks `response.ok`,
  returning a boolean.
- The quote-download flow in `QuotifyHome.jsx` now `await`s the call so
  the POST completes before the PDF download starts. Fire-and-forget was
  losing events whenever the browser navigated to the download URL before
  the fetch reached Railway.

### If you add a new analytics query, use this template

```sql
-- Group / filter on user_id (the stable Clerk sub), NEVER on user_name.
-- The COALESCE(NULLIF(user_id, ''), user_name) fallback remains as a
-- safety net for any pre-backfill rows that haven't been consolidated
-- yet, but after run_startup_backfill() the fallback branch is unused.
SELECT user_id, COUNT(*) FROM analytics_events
WHERE created_at >= $1
GROUP BY user_id;
```

## 10. Developer-only parse/accuracy metrics (2026-04-20)

Separate from the user-facing `analytics_events` pipeline, there is now a
**developer-only** metrics pipeline for reasoning about LLM orchestration
trade-offs (latency vs. manual-edit count across different designs).

### Where the code lives

- **Backend** — `backend/dev_metrics_api.py`
  - `POST /api/dev-metrics/log` — OPEN (no auth). Accepts a "parse" event
    (latency) or "quote" event (manual-edit counts + list). Both shapes
    share the same Pydantic model (`DevMetricEvent`) and are joined in
    the viewer by `parse_id`.
  - `GET /api/dev-metrics/data` — gated by `X-Dev-Metrics-Key` header
    matching the `DEV_METRICS_API_KEY` env var on Railway. Returns
    newest-first rows for the viewer.
  - Table `parse_metrics` is defined in `backend/database.py` `init_db()`
    alongside the other tables. Columns: `id`, `created_at`, `event`,
    `parse_id`, `insurance_type`, `pdf_count`, `latency_ms`,
    `manual_changes_all_count`, `manual_changes_non_client_count`,
    `manual_changes` (JSONB), `system_design`.
  - Router mounted in `backend/main.py` alongside the others.

- **Frontend helper** — `frontend/src/devMetrics.js`
  - `SYSTEM_DESIGN_VERSION` constant — bump when the LLM orchestration is
    changed (models, passes, prompts, fallback chain, skill layer) and
    append a new section to `dev_metrics/SYSTEM_DESIGN.md`.
  - `startParseTimer({ insuranceType, pdfCount })` — call at the top of
    each parse function. Returns a session object with a freshly
    generated `parse_id` and start time.
  - `logParseComplete(session)` — call in the `finally` block of each
    parse function. Skips aborted sessions (session.aborted = true in
    the AbortError branch).
  - `logQuoteGenerated({ parseId, insuranceType, manualMap, formValues })`
    — call after a successful quote PDF download.
  - Client-info field keys are excluded from `non_client_count`:
    `client_name`, `client_address`, `client_phone`, `client_email`,
    `named_insured`, `mailing_address`.

- **Frontend wiring** — `frontend/src/QuotifyHome.jsx`
  - 5 parse functions instrumented: `parseHomeownersFile`, `parseAutoFile`,
    `parseDwellingFile`, `parseBundleFiles`, `parseCommercialFile`. Each
    owns a local `__devSession` in function scope and logs in `finally`.
  - `lastParseIdRef` (React ref) carries the parse_id from parse to quote
    so `logQuoteGenerated` can join rows via `parse_id`.

- **Viewer** — `dev_metrics/viewer.html` (standalone HTML)
  - Asks for the Railway backend URL + `DEV_METRICS_API_KEY` (persisted
    to localStorage).
  - Joins parse + quote rows by `parse_id`, renders stats cards,
    filterable session table, pure-canvas latency chart, and a "Download
    JSONL" button.

- **System design doc** — `dev_metrics/SYSTEM_DESIGN.md`
  - Describes the current LLM orchestration in plain terms. Every
    `parse_metrics` row carries a `system_design` tag that points at a
    specific version of this doc. When the orchestration changes, bump
    `SYSTEM_DESIGN_VERSION` in `devMetrics.js` AND append a new section
    here so old rows remain interpretable.

### Rules of the road

- **Never put user PII in `parse_metrics`** beyond what already lives in
  the form (client names are captured as part of manual_changes for
  client_name/named_insured, which is fine because the developer viewer
  is key-gated).
- **`POST /api/dev-metrics/log` is intentionally open.** Testers on the
  live Vercel site are not Clerk admins, and we want their parse
  latencies in the dataset. Adding auth would silently gap the data.
- **`GET /api/dev-metrics/data` MUST remain key-gated.** The viewer is a
  local HTML file, so the `DEV_METRICS_API_KEY` env var is the auth.
- **Do not mutate the `event` strings.** The viewer hard-codes `"parse"`
  and `"quote"` to dispatch join behavior.
- **If you rename a parse function or change its file,** re-check the
  `__devSession` block is still in scope across its try/finally — it
  lives in the function body above the try, not inside it.


