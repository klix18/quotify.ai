# Dwelling Insurance Extraction Skill
> VERSION: 1.0
> TYPE: dwelling

## Overview
Extract structured data from dwelling insurance quote PDFs. These quotes cover
non-owner-occupied or investment properties (DP1/DP2/DP3 forms) and may include
multiple properties in a single document.

## Quick Pass Fields
Extract these fields quickly (key: value, one per line). For multi-property
documents, prefix with property_1_, property_2_, etc.:
  named_insured
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

## Field Guide

### Policy & Client
- `named_insured` — the insured / applicant / named insured / client, NOT the agency or agent.
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
"Rating & Underwriting", or "Location Details" sections — frequently at the BOTTOM
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
- `occupancy` — MUST output one of: "Owner Occupied", "Tenant Occupied", "Secondary Home", "Vacant", or "" if not stated.
  ALIASES: "Occupancy", "Usage Type"
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
  ALIASES: "AOP", "All Other Perils", "AOP Deductible"
- `wind_hail_deductible` — Wind/Hail deductible. May be "1%" or "2% of Coverage A".

Format 2 (combined):
- `deductible` — single combined deductible amount.
- `wind_hail_included` — MUST output "Yes", "No", or "" if not specified.
  "Yes" if wind/hail is included, "No" if excluded.
  NOTE: If "Windstorm or Hail Exclusion" endorsement exists, set to "No".

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
- NEVER fabricate values. If not explicitly printed, return "".
- When coverage shows "Included" or "Incl" as premium, it is bundled — do NOT put
  "Included" as a limit value.
- Each property is a separate array element.
- The premium_summary array must have one entry per property in the same order.
