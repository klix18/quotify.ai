> EXTENDS: dwelling
> CARRIER: sagesure

# SageSure — Dwelling Overrides

This patch extends the base dwelling skill. Only deviations are listed below.

## Layout Overrides
- SageSure places policies through multiple admitted carriers. The underlying carrier
  name (e.g. "Homeowners of America") may appear in small print — ignore it.
- Coverages are in a standard table on page 1.
- Payment Plans: **"Full Plan"**, **"2-Pay Plan"**, **"4-Pay Plan"**, **"10-Pay Plan"**.
  Map: Full Plan → full_pay, 2-Pay → two_pay, 4-Pay → four_pay, 10-Pay → monthly.
- **Rating & Underwriting** info is on page 2 as a text paragraph (not a table).
- Premium is in **"Quote Summary"** on the last page. Use "Annual Premium", NOT
  "Total Policy Cost" (which includes optional fees).

## Label Overrides
- "Sinkhole" deductible may appear in FL policies → `sinkhole_deductible` (if in schema)
- "Distance to Coast" → `distance_to_coast` (if in schema)
