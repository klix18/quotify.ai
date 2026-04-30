---
name: parse_dwelling
description: Use this skill when parsing a dwelling (DP1/DP2/DP3) insurance quote PDF
---

# Dwelling Insurance Extraction Skill
> VERSION: 2.2
> TYPE: dwelling

## Overview
Extract structured data from dwelling insurance quote PDFs. These quotes cover
non-owner-occupied or investment properties (DP1/DP2/DP3 forms) and may include
multiple properties in a single document.

## Quick Pass Fields
Extract these fields quickly (key: value, one per line). For multi-property
documents, prefix with property_1_, property_2_, etc.:
  named_insured
  client_address
  quote_date
  quote_effective_date
  quote_expiration_date
  total_premium
  property_1_address
  property_1_year_built
  property_1_construction_type
  property_1_roof_year
  property_1_occupancy
  property_1_policy_form
  property_1_dwelling_limit
  property_1_aop_deductible
  property_1_wind_hail_deductible
  property_1_deductible

## Field Guide

### Policy & Client
- `named_insured` — the insured / applicant / named insured / client, NOT the agency or agent.
- `client_address` — insured's mailing address. Prefer the block directly under the Named Insured.
  ALIASES: "Mailing Address", "Named Insured/Mailing Address", "Insured Address", "Address:" (when printed under the Named Insured or Applicant/Proposed Insured block), "Applicant Address", "Applicant Mailing Address", "Applicant Information" (use the street/city/state lines under this heading), "Proposed Insured Address".
  FALLBACK: If no separate mailing address is listed anywhere, use the only address shown for the insured, including when labeled "Residence Premises", "Risk Address", or "Described Location" on single-property quotes. If an "Applicant Information" block shows the Named Insured followed by street/city/state lines, treat those lines as the client_address (not the agent/producer address).
- `carrier_name` — insurance carrier/company name (e.g., "Tower Hill Prime", "American Modern",
  "Johnson & Johnson / Great Lakes", "SageSure / SafePort", "Markel / Emerald Bay", "NCJUA").
- `quote_date` — date the quote was generated/printed/prepared (MM/DD/YYYY).
- `quote_effective_date` — policy effective date (MM/DD/YYYY).
- `quote_expiration_date` — quote expiration or policy expiration date (MM/DD/YYYY).

### Agent Information
- `agent_name` — agent, advisor, producer, or retail producer name. NOT the agency company name.
- `agent_address` — agent's office address.
- `agent_phone` — agent's phone number.
- `agent_email` — agent's email address.

### Properties (array — capture ALL listed dwelling properties)
CRITICAL: Rating characteristics (year built, construction type, roof year, occupancy,
policy form) are often found ONLY in "Rating Characteristics", "Rating Factors",
"Rating & Underwriting", "Location Details", or "Rating Information" sections — frequently at the BOTTOM
of a page or on a LATER page. You MUST look there.

#### Dwelling Information
- `property_address` — address of this specific property (insured location).
- `year_built` — year the dwelling was built.
  ALIASES: "Year Built", "Year of Construction", "Year Dwelling Built", "Yr Built"
- `construction_type` — MUST output one of: "Frame", "Masonry", "Masonry Veneer", "Fire Resistive", "Superior", or "" if not stated.
  ALIASES: "Construction Type", "Construction", "Const Type"
  MAPPING: "Frame"/"Wood Frame"/"Vinyl Siding"/"Wood" → "Frame"; "Masonry Veneer" → "Masonry Veneer"; "Masonry"/"Brick" → "Masonry"; "Fire Resistive" → "Fire Resistive"; "Superior" → "Superior"
- `roof_year` — year roof was installed or last replaced.
  ALIASES: "Roof Year", "Year Roof Replaced", "Year of Roofing Updates", "Roof Covering Update Year"
  FALLBACK: If no explicit roof year/roofing update year appears anywhere OR the roof year field is blank/unknown (e.g., "", "—", "N/A", "Unknown", "TBD", "0"), set `roof_year` to `year_built`.
- `occupancy` — MUST output one of: "Owner Occupied", "Tenant Occupied", "Secondary Home", "Vacant", or "" if not stated.
  ALIASES: "Occupancy", "Usage Type", "Rental Term"
  MAPPING: "Rental"/"Tenant"/"Landlord"/"Renter"/"Landlord (owner non-occupied)" → "Tenant Occupied";
           "Owner"/"Primary"/"Owner Occupied" → "Owner Occupied";
           "Secondary"/"Seasonal"/"Secondary Home" → "Secondary Home";
           "Vacant" → "Vacant"
- `policy_form` — MUST output one of: "DP1", "DP2", "DP3", or "" if not stated.
  ALIASES: "Policy Form", "Program", "HO Form", "Policy Type"
  MAPPING: "DP-1"/"DP 1" → "DP1"; "DP-2"/"DP 2" → "DP2"; "DP-3"/"DP 3"/"Dwelling Special"/"Dwelling Property (DP3)" → "DP3"

#### Coverages
- `dwelling_limit` — Coverage A / Dwelling limit.
  ALIASES: "Dwelling", "Coverage A", "Coverage A - Dwelling", "Dwelling (Coverage A)"
- `dwelling_loss_settlement` — MUST output "RCV", "ACV", or "" if not stated.
  MAPPING: "Replacement Cost"/"Replacement Cost Value"/"RCV" → "RCV"; "Actual Cash Value"/"ACV" → "ACV"
- `other_structures_limit` — Coverage B / Other Structures.
  ALIASES: "Other Structures", "Coverage B", "Coverage B - Other Structures"
- `personal_property_limit` — Coverage C / Personal Property.
  ALIASES: "Personal Property", "Coverage C", "Contents"
- `personal_property_loss_settlement` — MUST output "RCV", "ACV", or "" if not stated.
- `personal_property_premium` — premium for personal property coverage.
- `fair_rental_value_limit` — Coverage D / Fair Rental Value / Loss of Use.
  ALIASES: "Fair Rental Value", "Coverage D", "Loss of Use", "Additional Living Expense"
- `premises_liability_limit` — Coverage E / Premises Liability / Personal Liability.
  ALIASES: "Premises Liability", "Personal Liability", "Liability", "Coverage E"
  NOTE: Use "N/A" ONLY if document explicitly excludes it. Use "" if simply not found.
- `premises_liability_premium` — premium for premises liability.
- `medical_payments_limit` — Coverage F / Medical Payments. If shown as "$1,000/$25,000", extract "$1,000" (per-person).
  ALIASES: "Medical Payments", "Medical Payments to Others", "Coverage F"
- `water_backup_limit` — Water Backup / Sewer / Sump Overflow.
  ALIASES: "Water Backup", "Water Backup and Sump Overflow", "Limited Water Back-Up"
  NOTE: Use "N/A" ONLY if explicitly excluded. Use "" if not mentioned.
- `water_backup_premium` — premium for water backup.
- `ordinance_or_law_limit` — may be a percentage like "10%".
- `extended_replacement_cost` — may be a percentage like "25%".

#### Deductibles (fill whichever format applies)
Format 1 (separate):
- `aop_deductible` — All Other Perils / AOP deductible.
  ALIASES: "AOP", "All Other Perils", "AOP Deductible", "All Perils Deductible", "All Perils", "All Peril"
- `wind_hail_deductible` — Wind/Hail deductible. May be "1%" or "2% of Coverage A".

Format 2 (combined):
- `deductible` — single combined deductible amount.
- `wind_hail_included` — MUST output "Yes", "No", or "" if not specified.
  "Yes" if wind/hail is included, "No" if excluded.
  NOTE: If "Windstorm or Hail Exclusion" endorsement exists, set to "No".

Cross-rule:
- If only one deductible is shown and it is an All Perils/AOP/general deductible (e.g., "Deductible: All Perils $2,500"), populate BOTH `aop_deductible` and the combined `deductible` with the same value.

### Premium Summary (array — one entry per property, same order)
- `total_premium` — total policy premium.
  ALIASES: "Total Premium", "Total Policy Premium", "Total Cost", "Total Amount Due"

### Payment Plans (combined for all properties)
For each plan (full_pay, two_pay, four_pay, monthly):
- `full_pay_amount` — single full-pay amount.
- `down_payment` — required down payment.
- `amount_per_installment` — amount per installment after down payment.
- `number_of_installments` — count of installments (digits only: "1", "3", "9").
ALIASES: "Full Plan"/"Full Pay"/"Pay in Full" → full_pay; "2-Pay Plan"/"Two Pay" → two_pay;
         "4-Pay Plan"/"Four Pay" → four_pay; "10-Pay Plan"/"Monthly" → monthly

#### Paid-in-Full Discount (object under `payment_plans.paid_in_full_discount`)
Only populate these three fields when the quote itself shows a pay-in-full
discount (an amount saved for paying the full term up front). If the quote
only shows a plain full-pay total (no discount vs. installments), leave all
three as "".

- `gross_premium` — full-term premium BEFORE the pay-in-full discount is
  applied. ALIASES: "Gross Premium", "Total Premium Before Discount",
  "Annual Premium".
- `discount_amount` — dollar amount saved by choosing to pay in full.
  ALIASES: "Pay-in-Full Discount", "Paid in Full Savings",
  "Full Pay Discount". Preserve "$" formatting.
  Sanity check: `gross_premium` − `discount_amount` should equal
  `net_pay_in_full`.
- `net_pay_in_full` — amount due if paying in full AFTER the discount is
  applied. ALIASES: "Net Pay-in-Full", "Total if Paid in Full",
  "Amount Due if Paid in Full".

## Type-Specific Rules
- CRITICAL: Read EVERY page. Rating characteristics are often on the LAST page.
- NEVER fabricate values. If not explicitly printed, return "". Exception: If `roof_year` is not shown anywhere or is blank/unknown, set it equal to `year_built` when available.
- When coverage shows "Included" or "Incl" as premium, it is bundled — do NOT put
  "Included" as a limit value.
- Each property is a separate array element.
- The premium_summary array must have one entry per property in the same order.

## Carrier-Specific Overrides
Detect the carrier from the PDF logo / letterhead. When the carrier matches one
of the sections below, apply its overrides ON TOP of the base rules above. The
base rules still apply for any field not mentioned in the override section.

### American Modern
Layout Overrides:
- **"Dwelling Details"** section contains year_built, construction_type, roof_year.
- Coverages are listed WITHOUT Coverage A/B/C labels — just "Dwelling", "Other Structures", etc.
- **"Policy Type: Dwelling Special"** = DP3.
- "Annual Policy Premium" is the base total; "Total Estimated Cost" includes fees — use
  "Total Estimated Cost" as `total_premium`.

Label Overrides:
- "Loss of Rents" → `fair_rental_value_limit` (rental property variant).
- "Fair Rental Value" → `fair_rental_value_limit` (owner-occupied variant).
- "All Peril Deductible" → `aop_deductible`.
- Wind/Hail percentage deductible shown as "X% Wind/Hail" — does NOT separate Hurricane from Wind/Hail.

Extra Fields:
- "Occupancy" field: Owner / Tenant / Vacant → `occupancy`.
- "Roof Material" → `roof_material` (if present in the schema).

### J&J / Great Lakes
Layout Overrides:
- Coverage table uses **"COVERAGE A - DWELLING (RCV)"** format with LIMIT and PREMIUM columns.
- **"RATING FACTORS & UNDERWRITING INFORMATION"** section (bottom of page or page 2) has:
  policy_form, occupancy, construction_type, year_built, roof_year.
  Always prefer these values over any shown elsewhere.
- Quotes may show multiple options (Option A / Option B) — extract the selected/highlighted
  option, defaulting to Option A if unclear.

Label Overrides:
- "Bldg" / "Building" → `dwelling_limit`.
- "OtherStr" / "Other Structures" → `other_structures_limit`.
- "Pers Prop" / "PP" → `personal_property_limit`.
- "ALE" (Additional Living Expense) → `fair_rental_value_limit`.
- "Med Pay" → `medical_payments_limit`.
- "Proposed Insured" → `named_insured` (not "Named Insured").
- "Risk Address" / "Location Address" → `property_address`.
- "Wind/Hurricane Deductible" → combined wind and hurricane deductible.
- "Year of Roofing Updates" → `roof_year`.

### Markel / Emerald Bay
Layout Overrides:
- **"COVERAGE AND PREMIUM DETAILS"** table on page 1–2 has coverages.
- **"LOCATION DETAILS"** table (often page 3) has: year_built, construction_type,
  occupancy, roof_year. Always prefer this table over any front-page values.
- Policy form is in the **"Effective Date / Expiration Date / Policy Form"** row.
- May appear under carrier names "RPS", "Emerald Bay", or "Lloyd's" — all normalize to markel.

### NCJUA / FAIR Plan
Layout Overrides:
- Simple text layout, NOT a table. Coverages listed as plain text lines:
  "A - Dwelling $X", "B - Other Structures $X", etc.
- Single deductible line: **"Deductible: All Perils"** → populate BOTH `aop_deductible` and `deductible` with the same value.
- Policy form labeled **"Policy Form:"** as plain text.
- Premium is the total shown at the bottom of the quote, no separate premium breakdown.

### SageSure
Layout Overrides:
- SageSure places policies through multiple admitted carriers. The underlying carrier
  name (e.g. "Homeowners of America") may appear in small print — ignore it.
- Coverages are in a standard table on page 1.
- Payment Plans: **"Full Plan"**, **"2-Pay Plan"**, **"4-Pay Plan"**, **"10-Pay Plan"**.
  Map: Full Plan → full_pay, 2-Pay → two_pay, 4-Pay → four_pay, 10-Pay → monthly.
- **Rating & Underwriting** info is on page 2 as a text paragraph (not a table).
- Premium is in **"Quote Summary"** on the last page. Use "Annual Premium", NOT
  "Total Policy Cost" (which includes optional fees).

Label Overrides:
- "Sinkhole" deductible may appear in FL policies → `sinkhole_deductible` (if in schema).
- "Distance to Coast" → `distance_to_coast` (if in schema).

### Tower Hill
Layout Overrides:
- Rating characteristics (year_built, construction_type, roof_year, occupancy, policy_form)
  are in a small table labeled **"Rating Characteristics:"** at the BOTTOM of page 1.
  These override any values shown elsewhere — always prefer this table.
- The **"Program:"** field in that table contains the policy form (e.g. "DP-3" → "DP3").
- Premium is labeled **"Estimated Annual Premium"** on the declarations page.
  A summary table with **"Total Due"** on page 2–3 is the most reliable figure.

Label Overrides:
- "Coverage A – Dwelling" → `dwelling_limit`.
- "Coverage D – Loss of Use" may appear as **"Fair Rental Value"** → `fair_rental_value_limit`.
- Wind/Hail deductible may be listed separately from Hurricane — capture both.
- Hurricane deductible is a **percentage of Coverage A** (e.g. "2%").
