---
name: parse_commercial
description: Use this skill when parsing a commercial insurance quote/proposal PDF
---

# Commercial Insurance Extraction Skill
> VERSION: 2.0
> TYPE: commercial

## Overview
Extract structured data from commercial insurance quote/proposal PDFs. These proposals
cover business insurance across multiple lines (Commercial Property, General Liability,
Workers' Compensation, Excess/Umbrella, Cyber, Wind). Not all lines appear in every proposal.

## Quick Pass Fields
Extract these fields quickly (key: value, one per line):
  named_insured
  quote_date
  quote_effective_date
  quote_expiration_date
  total_premium
  policy_term
  building_limit
  bpp_limit
  gl_each_occurrence
  gl_general_aggregate
  wc_bi_accident_each_accident

## Field Guide

### Policy & Client
- `named_insured` — the insured / applicant / named insured / client, NOT the agency or broker.
- `mailing_address` — client's mailing address.
- `client_email` — client's email address if present.
- `client_phone` — client's phone number if present.
- `policy_term` — overall policy term period, e.g. "06/20/2025 - 06/20/2026".
- `total_premium` — total annual premium across ALL lines of business combined.
  ALIASES: "Total Premium", "Total Annual Premium", "Grand Total"
- `quote_date` — date quote/proposal was generated or printed (MM/DD/YYYY).
  ALIASES: "Quote Date", "Proposal Date", "Print Date", "Prepared On"
- `quote_effective_date` — date coverage becomes effective (MM/DD/YYYY).
  ALIASES: "Effective Date", "Inception Date", "Policy Effective Date"
- `quote_expiration_date` — date quote expires or policy expiration date (MM/DD/YYYY).
  ALIASES: "Expiration Date", "Quote Expires", "Policy Expiration Date"
- `additional_premiums_taxes_fees` — additional premiums, taxes, and fees total.
  ALIASES: "Additional Premiums, Taxes, Fees", "Taxes & Fees"

### Agent / Broker
- `agent_name` — agent, advisor, producer, or broker name. NOT the brokerage company name.
- `agent_address` — agent's office address.
- `agent_phone` — agent's phone number.
- `agent_email` — agent's email address.

### Commercial Property
- `building_limit` — Building coverage limit. ALIASES: "Building", "Building Limit"
- `building_deductible` — Building deductible.
- `bpp_limit` — Business Personal Property limit. ALIASES: "Business Personal Property", "BPP", "Contents"
- `bpp_deductible` — BPP deductible.
- `stretch_blanket` — Stretch Blanket or Blanket limit. ALIASES: "Stretch Blanket", "Blanket"
- `business_income` — Business Income coverage limit or period.
- `business_income_waiting_period` — Waiting period, e.g. "24 hours".
- `equipment_breakdown` — Equipment Breakdown limit. ALIASES: "Boiler & Machinery"
- `back_up_sewers_drains` — Back-up of Sewers & Drains limit. ALIASES: "Sewer Backup", "Water Backup"
- `ordinance_or_law` — Ordinance or Law coverage limit.
- `wind_hail_deductible` — Wind/Hail deductible if separate.

### General Liability
- `gl_each_occurrence` — Each Occurrence limit. ALIASES: "Each Occurrence", "Per Occurrence"
- `gl_general_aggregate` — General Aggregate limit. ALIASES: "General Aggregate"
- `gl_products_completed_ops_aggregate` — Products/Completed Operations Aggregate.
- `gl_medical_expenses` — Medical Expenses limit. ALIASES: "Medical Expenses", "Medical Expense"
- `gl_damage_to_premises_rented` — Damage to Premises Rented to You.
  ALIASES: "Fire Damage", "Damage to Rented Premises"
- `gl_personal_advertising_injury` — Personal and Advertising Injury limit.

### Workers' Compensation
Coverage limits:
- `wc_bi_accident_each_accident` — Bodily Injury by Accident – Each Accident.
  ALIASES: "BI by Accident Each Accident"
- `wc_bi_disease_policy_limit` — Bodily Injury by Disease – Policy Limit.
- `wc_bi_disease_each_employee` — Bodily Injury by Disease – Each Employee.

Class codes (array — extract ALL class codes found):
- `class_code` — classification class code (e.g., "8859").
- `estimated_annual_remuneration` — estimated annual remuneration/payroll.
  ALIASES: "Annual Remuneration", "Estimated Payroll"
- `rating` — rate or modifier for this class code. ALIASES: "Rate", "Rating", "Modifier"
- `premium` — premium for this class code.

### Excess / Umbrella Liability
- `umbrella_each_occurrence` — Umbrella Each Occurrence limit.
- `umbrella_aggregate` — Umbrella Aggregate limit.

### Cyber Liability
- `cyber_aggregate_limit` — Policy Aggregate Limit of Liability.
  ALIASES: "Policy Aggregate Limit", "Aggregate Limit of Liability"
- `cyber_deductible` — General deductible for cyber coverage.
- `cyber_breach_response` — Breach Response Costs limit.
- `cyber_business_interruption` — Business Interruption limit.
- `cyber_cyber_extortion` — Cyber Extortion Loss limit.
- `cyber_funds_transfer_fraud` — Funds Transfer Fraud limit.
- `cyber_regulatory_defense` — Regulatory Defense & Penalties limit.
- `cyber_media_tech_liability` — Media, Tech, Data & Network Liability limit.

### Wind Insurance
- `wind_coverage` — Wind coverage limit or description. ALIASES: "Named Storm"
- `wind_deductible` — Wind deductible (dollar amount).
- `wind_percent_deductible` — Wind percentage deductible (e.g., "2%", "5%").
- `wind_coverage_premium` — Premium for wind coverage.
- `wind_buydown` — Wind buydown description or limit.
- `wind_buydown_amount` — Buydown amount.
- `wind_buydown_premium` — Premium for wind buydown.

## Type-Specific Rules
- CRITICAL: Read EVERY page. Commercial proposals often have coverage details across many pages.
- Not all proposals contain all lines of business. Only extract sections that are present.
  Leave fields "" for absent lines.
- NEVER fabricate values. If not explicitly printed, return "".
- Workers' Comp class codes are a repeating array — extract ALL of them.
