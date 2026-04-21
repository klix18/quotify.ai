---
name: parse_bundle
description: Use this skill when parsing a bundle (homeowners + auto) insurance quote PDF
---

# Bundle Insurance Extraction Skill
> VERSION: 2.0
> TYPE: bundle
> @include homeowners
> @include auto

## Overview
Extract structured data from bundle (homeowners + auto) insurance quote PDFs.
These may be a single combined document or two separate PDFs processed together.
Apply both the homeowners skill and auto skill simultaneously. The full content
of the `parse_homeowners` and `parse_auto` skills (including every carrier
override) is included above via the `@include` directives.

## Quick Pass Fields
Extract all homeowners AND auto quick-pass fields. Prefix with section if ambiguous:
  client_name
  quote_date
  quote_effective_date
  quote_expiration_date
  home_premium
  auto_premium
  bundle_total_premium
  dwelling
  other_structures
  personal_property
  personal_liability
  all_perils_deductible
  wind_hail_deductible
  bi_limit
  pd_limit
  policy_term

## Field Guide
Apply ALL field guidance from the parse_homeowners skill for property coverage fields.
Apply ALL field guidance from the parse_auto skill for vehicle coverage fields.

### Bundle-Specific Fields
- `home_premium` — total premium for the homeowners portion.
- `auto_premium` — total premium for the auto portion.
- `bundle_discount` — any multi-policy / bundle discount applied.
- `bundle_total_premium` — grand total across both policies (home + auto).

## Type-Specific Rules
- If processing a single combined PDF, extract both homeowners and auto sections.
- If the document only contains one policy type, extract what is available and leave
  the other section empty.
- Apply all homeowners rules (and carrier overrides) to home fields.
- Apply all auto rules (and carrier overrides) to vehicle/driver fields.
- Bundle discounts may appear as a line item on either section or as a combined summary.
