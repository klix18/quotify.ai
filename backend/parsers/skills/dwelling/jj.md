> EXTENDS: dwelling
> CARRIER: jj

# J&J / Great Lakes — Dwelling Overrides

This patch extends the base dwelling skill. Only deviations are listed below.

## Layout Overrides
- Coverage table uses **"COVERAGE A - DWELLING (RCV)"** format with LIMIT and PREMIUM columns.
- **"RATING FACTORS & UNDERWRITING INFORMATION"** section (bottom of page or page 2) has:
  policy_form, occupancy, construction_type, year_built, roof_year.
  Always prefer these values over any shown elsewhere.
- Quotes may show multiple options (Option A / Option B) — extract the selected/highlighted
  option, defaulting to Option A if unclear.

## Label Overrides
- "Bldg" / "Building" → `dwelling_limit`
- "OtherStr" / "Other Structures" → `other_structures_limit`
- "Pers Prop" / "PP" → `personal_property_limit`
- "ALE" (Additional Living Expense) → `fair_rental_value_limit`
- "Med Pay" → `medical_payments_limit`
- "Proposed Insured" → `named_insured` (not "Named Insured")
- "Risk Address" / "Location Address" → `property_address`
- "Wind/Hurricane Deductible" → combined wind and hurricane deductible
- "Year of Roofing Updates" → `roof_year`
