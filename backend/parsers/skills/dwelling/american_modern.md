> EXTENDS: dwelling
> CARRIER: american_modern

# American Modern — Dwelling Overrides

This patch extends the base dwelling skill. Only deviations are listed below.

## Layout Overrides
- **"Dwelling Details"** section contains year_built, construction_type, roof_year.
- Coverages are listed WITHOUT Coverage A/B/C labels — just "Dwelling", "Other Structures", etc.
- **"Policy Type: Dwelling Special"** = DP3.
- "Annual Policy Premium" is the base total; "Total Estimated Cost" includes fees — use
  "Total Estimated Cost" as `total_premium`.

## Label Overrides
- "Loss of Rents" → `fair_rental_value_limit` (rental property variant)
- "Fair Rental Value" → `fair_rental_value_limit` (owner-occupied variant)
- "All Peril Deductible" → `aop_deductible`
- Wind/Hail percentage deductible shown as "X% Wind/Hail" — does NOT separate Hurricane from Wind/Hail.

## Extra Fields
- "Occupancy" field: Owner / Tenant / Vacant → `occupancy`
- "Roof Material" → `roof_material` (if present in the schema)
