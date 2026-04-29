---
name: parse_homeowners
description: Use this skill when parsing a homeowners insurance quote PDF
---

# Homeowners Insurance Extraction Skill
> VERSION: 2.1
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
- `quote_effective_date` — when the policy/quote becomes effective (MM/DD/YYYY). Also labeled "Proposed Effective Date", "Eff. Date", or "Effective".
- `quote_expiration_date` — when the quote expires, often 30–60 days after quote date (MM/DD/YYYY). May be labeled "Quote Expires", "Expiration", "EXPIRATION DATE", "Good Thru/Through", or (on some quote forms) "Proposed Effective Date". The label and date may be on separate lines; if a time is shown (e.g., 12:01 AM), ignore it and capture the date only.
- `client_name` — the insured / prepared-for person, NOT the agency. Format as "First Last", never "Last, First".
- `client_address` — single-line mailing or insured address string. Also labeled "Property Address", "Location Address", "Insured Location", "Premises Address", "Property Location", "Address:" (in the insured/location section), or appears under headings like "NAMED INSURED/MAILING ADDRESS" or "Applicant Information" directly beneath the client name. Join multi-line addresses into one line as "Street, City, ST ZIP"; if ZIP+4 is present, keep only the 5-digit ZIP.
- `client_phone` — insured's phone if shown.
- `client_email` — insured's email if shown.

### Coverages
- `dwelling` — Coverage A / Dwelling limit.
- `other_structures` — Coverage B / Other Structures limit.
- `personal_property` — Coverage C / Personal Property limit.
- `loss_of_use` — Coverage D / Loss of Use / Additional Living Expense limit.
- `personal_liability` — Coverage E / Personal Liability limit.
- `medical_payments` — Coverage F / Medical Payments to Others limit.
- `water_and_sewer_backup` — Water Backup / Sewer Backup / Sump Overflow limit. May be shown as the endorsement "Limited Water Back-Up and Sump Discharge or Overflow Coverage" (HO 04 84). If a row shows both a limit and a separate premium, capture the limit (first $ amount) and ignore the premium.

### Deductibles
- `all_perils_deductible` — All Other Perils (AOP) deductible. Also labeled "AOP Deductible", "All-Perils Deductible", or "All Other Perils". May combine percent + dollars: "2% - $3,076". This value may appear inline with other rating text (e.g., alongside Territory/Protection Class) — still capture the deductible amount.
- `wind_hail_deductible` — Wind/Hail deductible. Also labeled "Wind or Hail", "Windstorm/Hail", or may appear parenthetically after a generic "Deductible:" line (e.g., "Deductible: The greater of 1% or $2,500 (Wind/Hail)"). May be a percentage of Coverage A. If shown as a combo (percent and dollars) or as "greater of X% or $Y", capture both as "X% - $Y".

### Endorsements
- `replacement_cost_on_contents` — MUST be "Yes", "No", or "". If an endorsement adds Replacement Cost on Contents / Personal Property RCV, set to "Yes". Also labeled "Personal Property Replacement Cost".
- `25_extended_replacement_cost` — MUST be "Yes", "No", or "". If an endorsement adds 25% Extended Replacement Cost, set to "Yes". Also labeled "Specified Additional Amount of Insurance for Coverage A - Dwelling" or "Additional Coverage A". This often appears in an Optional/Optional Coverages section with a dollar limit and a premium status (e.g., "Applied"); set to "Yes" whenever present and ignore the $ amount.
- When an endorsement/coverage line lists a coverage limit and a separate premium amount, extract the coverage limit (first $ value) and ignore the premium.

## Type-Specific Rules
- Do not infer advisor info unless clearly present.
- For names, always format as "First Last", never "Last, First".
- Preserve money formatting with a leading $: "$1,015.00", "$153,814", "$2,500".
- Format all dates as MM/DD/YYYY. Return partial dates as-is if only partial info is shown. Ignore trailing times (e.g., 12:01 AM) when present with dates.
- For deductible fields combining percent and dollars (including "greater of X% or $Y" phrasing), preserve both as "X% - $Y".
- For addresses shown on multiple lines, join into a single line and normalize as "Street, City, ST ZIP" (use 5-digit ZIP even if ZIP+4 is shown). Prefer the insured/location or named insured mailing address; do not capture agency addresses.

## Carrier-Specific Overrides
Detect the carrier from the PDF logo / letterhead. When the carrier matches one
of the sections below, apply its overrides ON TOP of the base rules above. The
base rules still apply for any field not mentioned in the override section.

### SageSure
Layout Overrides:
- SageSure places through multiple admitted carriers. Ignore any underlying carrier name in small print — treat the document as SageSure.
- Premium is in **"Quote Summary"** on the last page. Use **"Annual Premium"**, NOT "Total Policy Cost" (which includes optional fees and installment charges).
- **"Property Information"** section always shows: construction_type, year_built, protection_class, roof_shape, roof_material.

Label Overrides:
- "Sinkhole" deductible may appear in FL policies.
- "Replacement Cost Value" annotation next to Coverage C → contents are on RC basis.

Common Endorsements:
- "Screened Enclosure" → sublimit for screened lanais/pools.
- "Law & Ordinance" → percentage (10% / 25%).
- "Equipment Breakdown Protection".
- "Water Backup and Sump Overflow" → sublimit.

### Tower Hill
Layout Overrides:
- Rating characteristics (year_built, construction_type, roof_year, protection_class, BCEG)are in a "Rating Worksheet" on a later page. These override front-page values.
- **"Program:"** field → policy form (HO-3 is most common).
- Premium: **"Estimated Annual Premium"** on declarations page. A **"Premium Breakdown"** table on page 2 may show surcharges/credits.

Label Overrides:
- Hurricane deductible is a **percentage of Coverage A** (common: 2%, 5%).
- Wind/Hail may be listed separately from Hurricane — capture both.

Common Endorsements:
- "Replacement Cost on Personal Property" → RC vs ACV toggle.
- "Water Backup" → capture sublimit.
- "Screen Enclosure" → coverage amount.
- "Ordinance or Law" → percentage (10% / 25% / 50%).
