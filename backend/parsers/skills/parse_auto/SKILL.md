---
name: parse_auto
description: Use this skill when parsing an auto insurance quote PDF
---

# Auto Insurance Extraction Skill
> VERSION: 2.1
> TYPE: auto

## Overview
Extract structured data from auto insurance quote PDFs. These quotes cover
personal vehicles and include driver profiles, vehicle coverage, and payment options.

## Quick Pass Fields
Extract these fields quickly (key: value, one per line):
  client_name
  client_address
  client_phone
  quote_date
  quote_effective_date
  quote_expiration_date
  policy_term
  total_premium
  bi_limit
  pd_limit

## Field Guide

### Policy & Client
- `client_name` — the insured / applicant / named insured, NOT the agency.
- `client_address` — single-line mailing address.
- `client_phone` — insured's phone if shown.
- `quote_date` — print date, quote date, or proposal date (MM/DD/YYYY).
- `quote_effective_date` — policy effective date (MM/DD/YYYY).
- `quote_expiration_date` — policy expiration date (MM/DD/YYYY).
- `policy_term` — MUST be exactly "6-Month", "12-Month", or "Unknown".
  Determine from effective/expiration span if not stated: ~180-day = "6-Month", ~365-day = "12-Month".

### Drivers (array — capture ALL listed drivers)
- `driver_name` — full name.
- `gender` — "Male", "Female", or "Unknown" if not stated.
- `marital_status` — e.g. "Single", "Married", "Divorced". "" if absent.
- `license_state` — two-letter state abbreviation (e.g. "VA", "MD").

### Vehicles (array — capture ALL listed vehicles)
- `year_make_model_trim` — combine year, make, model, and trim: "2021 Toyota Camry LE".
- `vin` — full 17-character VIN. "" if not shown.
- `vehicle_use` — e.g. "Commute", "Pleasure", "Business". "" if absent.
- `garaging_zip_county` — ZIP code and/or county where vehicle is garaged.
- `coverage_premiums` — object with one key per coverage type for THIS vehicle:
    bi_premium, pd_premium, medpay_premium, um_uim_bi_premium, umpd_premium,
    comprehensive_premium, collision_premium, rental_premium, towing_premium.
    Use "" for any premium not listed.
- `comprehensive_deductible` — Comprehensive / Other-Than-Collision (OTC)
    deductible for THIS vehicle. May be labeled "Other Than Collision" or "OTC".
    Deductibles can differ by vehicle, so capture each vehicle's value
    independently. Use "" if not shown for this vehicle.
- `collision_deductible` — Collision deductible for THIS vehicle. Capture
    each vehicle's value independently. Use "" if not shown for this vehicle.
- `rental_limit` — Rental / Transportation-expense limit for THIS vehicle.
    Often shown as a daily × day cap like "$30/day × 30 days" or a total
    like "$900". Rental limits can differ by vehicle (one car might carry
    rental reimbursement, another might not), so capture each vehicle's
    value independently. Use "N/A" if the vehicle clearly does not carry
    rental; use "" if the document is silent for this vehicle.
- `towing_limit` — Towing & Labor / Roadside-assistance limit for THIS
    vehicle. Typical values look like "$75" or "Included". Towing limits
    can differ by vehicle, so capture each vehicle's value independently.
    Use "N/A" if the vehicle clearly does not carry towing; use "" if the
    document is silent for this vehicle.
- `subtotal` — total premium for this vehicle. Use document value if shown directly.

### Coverages (policy-level — one value each, NOT per-vehicle)
- `bi_limit` — Bodily Injury split limit, e.g. "$100,000 / $300,000".
- `pd_limit` — Property Damage limit, e.g. "$100,000".
- `medpay_limit` — Medical Payments limit. "N/A" if not offered.
- `um_uim_bi_limit` — Uninsured/Underinsured Motorist BI split limit.
  Check BOTH vehicle-level AND policy-level sections.
- `umpd_limit` — UM Property Damage limit. "N/A" if not offered.
- `umpd_deductible` — UMPD deductible. "N/A" if not applicable.

> **Note:** Rental/Transportation and Towing/Roadside limits are NOT
> policy-level — capture them under each vehicle's `rental_limit` and
> `towing_limit` fields (see Vehicles section above), since they can
> differ between vehicles on the same policy.

### Payment Options
- `full_pay_amount` — single full-pay amount for entire policy term.
For each installment plan (semi_annual, quarterly, monthly):
- `down_payment` — required down payment.
- `amount_per_installment` — amount due per installment after down payment.
- `number_of_installments` — count of installments after down payment (digits only).

#### Paid-in-Full Discount (object under `payment_options.paid_in_full_discount`)
Populate these three fields ONLY if the quote explicitly shows a pay-in-full
discount (labels like "Paid-in-Full Discount", "Pay-in-Full Savings",
"Full-Pay Discount", "PIF Discount"). If no such discount is shown, leave
all three as "". Do NOT invent a discount by back-solving from installment
totals.
- `gross_premium` — full-term premium BEFORE the pay-in-full discount is applied.
  ALIASES: "Gross Premium", "Premium Before Discount", "Undiscounted Premium",
           "Total Premium (Before Discount)".
- `discount_amount` — dollar amount saved by choosing to pay in full.
  ALIASES: "Paid-in-Full Discount", "Pay-in-Full Savings", "Full-Pay Discount",
           "PIF Discount", "Discount for Paying in Full".
  If only a percentage is shown (e.g. "5% PIF discount"), compute the dollar
  amount from `gross_premium` and preserve "$" formatting.
- `net_pay_in_full` — amount due if paying in full AFTER the discount is applied.
  ALIASES: "Net Pay-in-Full", "Total if Paid in Full", "Pay-in-Full Total",
           "Amount Due (Paid in Full)".
  Sanity check: `gross_premium` − `discount_amount` should equal `net_pay_in_full`.
  If the quote only gives two of the three, derive the third.

### Premium Summary
- `vehicle_subtotals` — array of strings, one subtotal per vehicle in order.
- `total_premium` — grand-total premium for the policy term.
- `paid_in_full_discount` — mirror of `payment_options.paid_in_full_discount.discount_amount`
  as a flat string. "" if none.
- `total_pay_in_full` — mirror of `payment_options.paid_in_full_discount.net_pay_in_full`
  as a flat string. "" if no pay-in-full discount is offered.

## Type-Specific Rules
- Each driver and vehicle is a separate array element.
- Keep per-vehicle coverage premiums attached to the correct vehicle.
- Comprehensive / Collision deductibles and Rental / Towing limits are
  all PER-VEHICLE. Even if every vehicle shows the same value on the
  quote, populate each vehicle's `comprehensive_deductible`,
  `collision_deductible`, `rental_limit`, and `towing_limit`
  individually. If one vehicle carries rental/towing and another doesn't,
  reflect that difference here rather than flattening to a policy-wide
  value.
- Split limits must use the " / " separator: "$X / $Y".
- Preserve money formatting with a leading $: "$1,250.00", "$500".
- Format all dates as MM/DD/YYYY.
- Do NOT invent data. If not in the document, use "".
- Use "" for strings, [] for arrays when a field cannot be found.

## Carrier-Specific Overrides
Detect the carrier from the PDF logo / letterhead. When the carrier matches one
of the sections below, apply its overrides ON TOP of the base rules above. The
base rules still apply for any field not mentioned in the override section.

### Progressive
Layout Overrides:
- Quote format: **"Quote Summary"** on page 1, driver/vehicle detail pages following.
- Premium may be **"6-Month Premium"** — look for annual equivalent too.
  Do NOT use "Total Due Today" (includes down payment).
- Per-vehicle premium breakdown on later pages.
- **"Excluded"** drivers listed separately — still capture with a note.

Label Overrides:
- "Garaging Address" → per-vehicle field if different from insured address.
- "PIP" in no-fault states → `medical_payments`.

Extra Fields:
- **"Discount Summary"** section → capture as comma-separated string in `discounts` field.
