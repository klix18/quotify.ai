# Wind / Hail Supplemental Extraction Skill
> VERSION: 1.0
> TYPE: wind_hail

## Overview
This skill is used as a **supplement** when the primary quote (Homeowners or
Dwelling) does NOT include wind/hail coverage — i.e. the primary quote shows
wind/hail as "N/A", "Excluded", or has a "Windstorm or Hail Exclusion"
endorsement. A standalone wind/hail quote is then uploaded separately, and
its values are merged into the primary quote's data.

This skill is NEVER the primary skill for an extraction call. It is appended
to the active homeowners or dwelling skill when a second (wind/hail) PDF is
present, and its instructions tell the model what to pull from that second
PDF and how to combine it with the primary one.

## What to Extract From the Wind/Hail PDF
You receive TWO PDFs in this call:
1. **Primary PDF** — the homeowners or dwelling quote (follow its skill for every
   field except wind/hail and total_premium).
2. **Wind/Hail PDF** — a standalone wind/hail-only quote for the same insured /
   same property(ies).

### For the Homeowners case (single property)
From the wind/hail PDF, extract:
- The **wind/hail deductible** (percent like "2% of Coverage A" or flat like
  "$2,500"). Write this into the primary quote's `wind_hail_deductible` field,
  **replacing** any "N/A" / empty value it had before.
- The **total premium** of the wind/hail policy. Take the primary quote's
  original total_premium and ADD the wind/hail total premium to it. Write
  the sum into the final `total_premium` field.

### For the Dwelling case (multiple properties, array)
The wind/hail quote typically covers the SAME set of properties as the
primary dwelling quote. For each property:
- Match wind/hail property rows to dwelling property rows by **address**
  first. If addresses are missing or inexact, fall back to order (row 1
  matches property 1, row 2 matches property 2, etc.).
- Copy the wind/hail **deductible** (percent or dollar amount) for that
  property into the dwelling property's `wind_hail_deductible` field,
  replacing any "N/A" / empty value.
- If the dwelling quote uses the combined-deductible format (`deductible`
  + `wind_hail_included`), set `wind_hail_included` to "Yes" for the
  property(ies) with wind/hail coverage from the second PDF.
- Sum each property's wind/hail premium into that property's matching
  `premium_summary` entry's `total_premium`.
- Sum the wind/hail policy's total premium into the document-level
  `total_premium` (or `premium_summary[*].total_premium`, matching the
  primary quote's structure).

## Summation Rules (Critical)
- Treat money strings as numbers for addition, then reformat with a leading
  "$" and comma separators: "$1,250.00" + "$350.00" → "$1,600.00".
- If the primary quote's `total_premium` is empty ("") but the wind/hail
  quote's isn't, write just the wind/hail amount. Do NOT fabricate a zero.
- If BOTH are empty, leave `total_premium` empty ("").
- Preserve the primary quote's currency formatting style (commas, cents).

## Wind/Hail Quote Anatomy — What to Look For
Wind/hail-only quotes commonly use these labels:
- `wind_hail_deductible` — "Wind/Hail Deductible", "Hurricane Deductible",
  "Named Storm Deductible", "Wind Deductible".
- `total_premium` — "Total Premium", "Annual Premium", "Policy Premium",
  "Total Cost".
- `property_address` — matches the primary quote's address.

## Non-Goals
- Do NOT overwrite any other primary-quote field (dwelling limit, liability,
  deductible, carrier, agent, etc.). The wind/hail skill is **only** responsible
  for `wind_hail_deductible` and the premium addition.
- Do NOT return separate wind_hail_premium or home_premium fields in the
  output — only the combined `total_premium` is reported.
- Do NOT create phantom properties. If the wind/hail PDF lists more or fewer
  properties than the primary dwelling PDF, match what you can and ignore
  the rest.
