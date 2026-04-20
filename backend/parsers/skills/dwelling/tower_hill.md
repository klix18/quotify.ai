> EXTENDS: dwelling
> CARRIER: tower_hill

# Tower Hill — Dwelling Overrides

This patch extends the base dwelling skill. Only deviations are listed below.
All fields not mentioned here follow the base skill definitions exactly.

## Layout Overrides
- Rating characteristics (year_built, construction_type, roof_year, occupancy, policy_form)
  are in a small table labeled **"Rating Characteristics:"** at the BOTTOM of page 1.
  These override any values shown elsewhere — always prefer this table.
- The **"Program:"** field in that table contains the policy form (e.g. "DP-3" → "DP3").
- Premium is labeled **"Estimated Annual Premium"** on the declarations page.
  A summary table with **"Total Due"** on page 2–3 is the most reliable figure.

## Label Overrides
- "Coverage A – Dwelling" → `dwelling_limit`
- "Coverage D – Loss of Use" may appear as **"Fair Rental Value"** → `fair_rental_value_limit`
- Wind/Hail deductible may be listed separately from Hurricane — capture both.
- Hurricane deductible is a **percentage of Coverage A** (e.g. "2%").
