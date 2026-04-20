# Homeowners Insurance Extraction Skill
> VERSION: 1.0
> TYPE: homeowners

## Overview
Extract structured data from homeowners insurance quote PDFs. These quotes cover
owner-occupied primary residences and include dwelling, liability, and personal
property coverages.

## Quick Pass Fields
Extract these fields as quickly as possible (key: value, one per line):
  total_premium
  quote_date
  quote_effective_date
  quote_expiration_date
  dwelling
  other_structures
  personal_property
  loss_of_use
  personal_liability
  medical_payments
  all_perils_deductible
  wind_hail_deductible
  water_and_sewer_backup
  client_name
  client_address
  client_phone
  client_email
  replacement_cost_on_contents
  25_extended_replacement_cost

## Field Guide

### Policy & Client
- `total_premium` — total annual or policy-term premium.
- `quote_date` — date the quote was generated/prepared (MM/DD/YYYY).
- `quote_effective_date` — when the policy/quote becomes effective (MM/DD/YYYY).
- `quote_expiration_date` — when the quote expires, often 30–60 days after quote date (MM/DD/YYYY).
- `client_name` — the insured / prepared-for person, NOT the agency. Format as "First Last", never "Last, First".
- `client_address` — single-line mailing or insured address string.
- `client_phone` — insured's phone if shown.
- `client_email` — insured's email if shown.

### Coverages
- `dwelling` — Coverage A / Dwelling limit.
- `other_structures` — Coverage B / Other Structures limit.
- `personal_property` — Coverage C / Personal Property limit.
- `loss_of_use` — Coverage D / Loss of Use / Additional Living Expense limit.
- `personal_liability` — Coverage E / Personal Liability limit.
- `medical_payments` — Coverage F / Medical Payments to Others limit.
- `water_and_sewer_backup` — Water Backup / Sewer Backup / Sump Overflow limit.

### Deductibles
- `all_perils_deductible` — All Other Perils (AOP) deductible. May combine percent + dollars: "2% - $3,076".
- `wind_hail_deductible` — Wind/Hail deductible. May be a percentage of Coverage A.

### Endorsements
- `replacement_cost_on_contents` — MUST be "Yes", "No", or "". If an endorsement adds
  Replacement Cost on Contents / Personal Property RCV, set to "Yes".
- `25_extended_replacement_cost` — MUST be "Yes", "No", or "". If an endorsement adds
  25% Extended Replacement Cost, set to "Yes".

## Type-Specific Rules
- Do not infer advisor info unless clearly present.
- For names, always format as "First Last", never "Last, First".
- Preserve money formatting with a leading $: "$1,015.00", "$153,814", "$2,500".
- Format all dates as MM/DD/YYYY. Return partial dates as-is if only partial info is shown.
- For deductible fields combining percent and dollars, preserve both: "2% - $3,076".
