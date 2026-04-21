---
name: parse_bundle_separate
description: Supplemental skill applied when a bundle is uploaded as two separate PDFs (one homeowners, one auto)
---

# Bundle — Separate-Mode Supplemental Skill
> VERSION: 2.0
> TYPE: bundle_separate

## Overview
This skill is a **supplement** that is appended to the base `parse_bundle` skill
when the user has uploaded TWO separate PDFs (one homeowners quote, one auto
quote) instead of a single combined bundle document.

This skill is NEVER the primary skill. It is injected AFTER the bundle
skill to give the model explicit guidance about which PDF contains which
policy's data — otherwise the model treats both PDFs as one combined
document and under-extracts auto.

## PDF Ordering — READ THIS CAREFULLY
You are receiving **TWO PDFs** in this call. Their order matters:

1. **PDF #1 (the FIRST attachment after the prompt)** is the
   **HOMEOWNERS quote**. Apply homeowners rules to PDF #1 to extract
   these schema fields:
   - `dwelling`, `other_structures`, `personal_property`, `loss_of_use`
   - `personal_liability`, `medical_payments`
   - `all_perils_deductible`, `wind_hail_deductible`, `water_and_sewer_backup`
   - `replacement_cost_on_contents`, `25_extended_replacement_cost`
   - `client_email` (home quotes often have it; auto quotes often don't)
   - `total_premium` and `home_premium` (see premium rules below)

2. **PDF #2 (the SECOND attachment)** is the **AUTO quote**. Apply
   auto rules to PDF #2 to extract these schema fields:
   - `policy_term` (exactly "6-Month", "12-Month", or "Unknown")
   - `drivers` (array — capture EVERY driver listed on PDF #2)
   - `vehicles` (array — capture EVERY vehicle listed on PDF #2, with
     each vehicle's own `coverage_premiums`, `comprehensive_deductible`,
     `collision_deductible`, and `subtotal`)
   - `coverages` (object — policy-level auto limits: `bi_limit`,
     `pd_limit`, `medpay_limit`, `um_uim_bi_limit`, `umpd_limit`,
     `umpd_deductible`, `rental_limit`, `towing_limit`)
   - `payment_options` (object — AUTO payment plans: `full_pay`,
     `semi_annual`, `quarterly`, `monthly`, `paid_in_full_discount`)
   - `premium_summary` (object — `vehicle_subtotals`, `total_premium`,
     `paid_in_full_discount`, `total_pay_in_full`)
   - `auto_premium` (see premium rules below)

## Critical Rules
- **Do NOT leave auto fields empty just because PDF #1 is a pure home
  quote.** PDF #1 will NOT contain any auto data — that's expected.
  Extract auto data from PDF #2, not from PDF #1.
- **Do NOT put home data into auto slots.** In particular:
  - `payment_options.full_pay.full_pay_amount` is the AUTO quote's
    full-pay amount from PDF #2. If PDF #1 shows a home full-pay total,
    do NOT put it here.
  - `drivers` and `vehicles` arrays come from PDF #2 ONLY.
  - `coverages.bi_limit`, `coverages.pd_limit`, etc. come from PDF #2.
- **Do NOT put auto data into home slots.** `dwelling`, `personal_property`,
  etc. are exclusively from PDF #1.
- **Shared client fields** (`client_name`, `client_address`, `client_phone`)
  may appear in both PDFs. Prefer PDF #1's value when present; fall
  back to PDF #2 if PDF #1 doesn't show it.
- **Dates** (`quote_date`, `quote_effective_date`, `quote_expiration_date`)
  may differ between PDFs. Prefer PDF #1's value; fall back to PDF #2.

## Premium Fields (schema-exact)
The bundle schema has FOUR premium-related top-level keys. Fill them like this:
- `total_premium` → PDF #1's homeowners total premium (home-side total).
  If PDF #1 doesn't show it, use "".
- `home_premium` → PDF #1's homeowners total premium (same value as
  `total_premium` above — we mirror it into the explicit bundle key
  `home_premium` for downstream display). Formatted as "$X,XXX.XX".
- `auto_premium` → PDF #2's auto total premium. Read from the auto
  quote's "Total Premium" / "Annual Premium" / "Policy Premium" line.
  If PDF #2 is a 6-month policy and shows a "Total 6 Month Premium",
  use that value verbatim — do NOT annualize it. Formatted as
  "$X,XXX.XX".
- `bundle_total_premium` → the sum of `home_premium` + `auto_premium`,
  reformatted as "$X,XXX.XX". If either side is empty, use the side
  you have and do NOT fabricate a zero.
- `bundle_discount` → only populate if an explicit multi-policy / bundle
  discount dollar amount appears on either PDF. Do NOT back-solve it.

## Anti-Patterns (do NOT do these)
- Do NOT treat the two PDFs as one combined document.
- Do NOT skip auto extraction because PDF #1 has no auto data.
- Do NOT populate `drivers` or `vehicles` from PDF #1 — they are PDF #2
  only. Leave these arrays empty if PDF #2 is somehow missing them, but
  NEVER fill them from PDF #1's homeowners data.
- Do NOT double-count premiums when computing `bundle_total_premium`.
- Do NOT re-assign PDF #1's home full-pay amount to
  `payment_options.full_pay.full_pay_amount` — that slot belongs to
  PDF #2's auto full-pay.
