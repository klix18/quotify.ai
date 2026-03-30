# dwelling_parser_api.py
# Uses Gemini Flash 2.5
# 2-pass extraction for dwelling insurance quotes:
#   Pass 1 = fast draft with gemini-2.5-flash-lite  (key:value streaming)
#   Pass 2 = strict structured JSON with gemini-2.5-flash
# Field mapping matches frontend dwellingConfig.js exactly.

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

load_dotenv()

router = APIRouter()


def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set. Add it to your .env file or environment.")
    return genai.Client(api_key=api_key)


# ── Flat top-level keys the AI must return ───────────────────────
FLAT_KEYS = [
    "named_insured",
    "insured_property_address",
    "carrier_name",
    "effective_date",
]

AGENT_KEYS = [
    "agent_name",
    "agent_address",
    "agent_phone",
    "agent_email",
]

PROPERTY_INFO_KEYS = [
    "property_address",
    "year_built",
    "construction_type",
    "roof_year",
    "occupancy",
    "policy_form",
]

COVERAGE_KEYS = [
    "dwelling_limit",
    "dwelling_loss_settlement",
    "other_structures_limit",
    "personal_property_limit",
    "personal_property_loss_settlement",
    "personal_property_premium",
    "fair_rental_value_limit",
    "premises_liability_limit",
    "premises_liability_premium",
    "medical_payments_limit",
    "water_backup_limit",
    "water_backup_premium",
    "ordinance_or_law_limit",
    "extended_replacement_cost",
]

DEDUCTIBLE_V1_KEYS = ["aop_deductible", "wind_hail_deductible"]
DEDUCTIBLE_V2_KEYS = ["deductible", "wind_hail_included"]

PREMIUM_KEYS = ["total_premium", "pay_in_full_discount", "total_if_paid_in_full"]

PLAN_NAMES = ["full_pay", "two_pay", "four_pay", "monthly"]
PAYMENT_PLAN_KEYS = ["amount_due", "installment_details", "installment_fee"]


# ── Gemini structured-output schema (Pass 2) ────────────────────

_property_props = {
    **{k: {"type": "string"} for k in PROPERTY_INFO_KEYS},
    **{k: {"type": "string"} for k in COVERAGE_KEYS},
    **{k: {"type": "string"} for k in DEDUCTIBLE_V1_KEYS},
    **{k: {"type": "string"} for k in DEDUCTIBLE_V2_KEYS},
}
_all_property_keys = (
    PROPERTY_INFO_KEYS + COVERAGE_KEYS + DEDUCTIBLE_V1_KEYS + DEDUCTIBLE_V2_KEYS
)

_premium_props = {k: {"type": "string"} for k in PREMIUM_KEYS}

_payment_plan_props = {k: {"type": "string"} for k in PAYMENT_PLAN_KEYS}

DWELLING_SCHEMA = {
    "type": "object",
    "properties": {
        # S1 – Dwelling Policy
        **{k: {"type": "string"} for k in FLAT_KEYS},

        # S2 – Agent Information
        **{k: {"type": "string"} for k in AGENT_KEYS},

        # S3 – Properties (repeatable)
        "properties": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _property_props,
                "required": _all_property_keys,
            },
        },

        # S5 – Premium Summary (per-property)
        "premium_summary": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _premium_props,
                "required": PREMIUM_KEYS,
            },
        },

        # S6 – Payment Plans
        "payment_plans": {
            "type": "object",
            "properties": {
                plan: {
                    "type": "object",
                    "properties": _payment_plan_props,
                    "required": PAYMENT_PLAN_KEYS,
                }
                for plan in PLAN_NAMES
            },
            "required": PLAN_NAMES,
        },
    },
    "required": FLAT_KEYS + AGENT_KEYS + ["properties", "premium_summary", "payment_plans"],
}


# ── Build confidence mirror schema ───────────────────────────────

def _to_confidence_type(prop_def):
    """Convert a schema property definition to its confidence equivalent (number)."""
    t = prop_def.get("type")
    if t == "string":
        return {"type": "number"}
    if t == "array":
        items = prop_def.get("items", {})
        if items.get("type") == "object":
            conf_props = {
                k: _to_confidence_type(v)
                for k, v in items.get("properties", {}).items()
            }
            return {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": conf_props,
                    "required": list(conf_props.keys()),
                },
            }
        return {"type": "array", "items": {"type": "number"}}
    if t == "object":
        conf_props = {
            k: _to_confidence_type(v)
            for k, v in prop_def.get("properties", {}).items()
        }
        return {
            "type": "object",
            "properties": conf_props,
            "required": list(conf_props.keys()),
        }
    return {"type": "number"}


# Add confidence object to schema
_data_props = dict(DWELLING_SCHEMA["properties"])
DWELLING_SCHEMA["properties"]["confidence"] = {
    "type": "object",
    "properties": {k: _to_confidence_type(v) for k, v in _data_props.items()},
    "required": list(_data_props.keys()),
}
DWELLING_SCHEMA["required"].append("confidence")


# ── Prompts ──────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert dwelling-insurance data extractor. You receive a scanned or
digital dwelling insurance quote / proposal / submission PDF and return a single
JSON object that maps exactly to the schema provided.

CRITICAL: You MUST read EVERY page of the PDF. Many critical fields (year built,
construction type, roof year, occupancy, policy form) appear ONLY in rating/
underwriting sections that are often on the LAST page or at the BOTTOM of a page.
Do NOT skip any page or section.

ABSOLUTE RULE: NEVER fabricate, guess, or hallucinate values. If a field is not
explicitly printed in the document, return "" (empty string). It is far better to
return "" than to return an incorrect value. Wrong data is worse than missing data.

─── FIELD GUIDANCE ───────────────────────────────────────────────

POLICY INFO
• named_insured            – the insured / applicant / named insured / client, NOT the agency or agent.
• insured_property_address – the INSURED LOCATION or DESCRIBED LOCATION address (the property being insured), NOT the mailing address.
• carrier_name             – the insurance carrier / company name (e.g., "Tower Hill Prime", "American Modern", "Johnson & Johnson / Great Lakes", "SageSure / SafePort", "Markel / Emerald Bay", "NCJUA").
• effective_date           – policy effective date or start of policy period. Use MM/DD/YYYY format.

AGENT INFORMATION
• agent_name    – the agent, advisor, producer, or retail producer name. NOT the agency company name.
• agent_address – the agent's office address.
• agent_phone   – the agent's phone number.
• agent_email   – the agent's email address.

PROPERTIES (array – capture ALL listed dwelling properties)
Each property object contains:

  ── Dwelling Information ──
  These fields are OFTEN found in a "Rating Characteristics", "Rating Factors",
  "Rating & Underwriting", "Location Details", or "Dwelling Details" section —
  which is frequently at the BOTTOM of the page or on a LATER page. You MUST
  look there.

  • property_address    – the address of this specific property (the insured location / described location).
  • year_built          – year the dwelling was built.
      ALIASES: "Year Built", "Year of Construction", "Year Dwelling Built", "Yr Built"
  • construction_type   – must be one of: "Frame", "Masonry", "Masonry Veneer",
                          "Fire Resistive", "Superior". Use "" if not stated.
      ALIASES: "Construction Type", "Construction", "Const Type"
      MAPPING: "Frame"/"Wood Frame"/"Vinyl Siding" → "Frame"
  • roof_year           – year the roof was installed or last replaced.
      ALIASES: "Roof Year", "Year Roof Replaced", "Year of Roofing Updates", "Roof Covering Update Year"
  • occupancy           – e.g. "Owner Occupied", "Tenant Occupied", "Vacant", "Rental", "Secondary Home".
      ALIASES: "Occupancy", "Usage Type"
      MAPPING: "Rental"/"Tenant"/"Landlord"/"Landlord (owner non-occupied)" → "Tenant Occupied";
               "Owner"/"Primary"/"Owner Occupied" → "Owner Occupied";
               "Secondary Home"/"Secondary"/"Seasonal" → "Secondary Home"
  • policy_form         – must be one of: "DP1", "DP2", "DP3". Use "" if not stated.
      ALIASES: "Policy Form", "Program", "HO Form", "Policy Type"
      MAPPING: "DP-1"/"DP 1" → "DP1"; "DP-2"/"DP 2" → "DP2"; "DP-3"/"DP 3"/"Dwelling Property (DP3)"/"Dwelling Special" → "DP3"

  ── Coverages ──
  Coverage amounts appear in tables, line items, or lists. Common label aliases:

  • dwelling_limit      – Coverage A / Dwelling limit amount.
      ALIASES: "Dwelling", "Coverage A", "Coverage A - Dwelling", "Dwelling (Coverage A)"
  • dwelling_loss_settlement – "RCV" or "ACV". Use "" if not stated.
      MAPPING: "Replacement Cost"/"Replacement Cost Value"/"RCV" → "RCV";
               "Actual Cash Value"/"ACV" → "ACV"
  • other_structures_limit – Coverage B / Other Structures limit.
      ALIASES: "Other Structures", "Coverage B", "Coverage B - Other Structures"
  • personal_property_limit – Coverage C / Personal Property limit.
      ALIASES: "Personal Property", "Coverage C", "Coverage C - Personal Property", "Contents"
  • personal_property_loss_settlement – "RCV" or "ACV" for personal property.
      MAPPING: same as dwelling_loss_settlement
  • personal_property_premium – premium charged specifically for personal property coverage.
  • fair_rental_value_limit – Coverage D / Fair Rental Value / Loss of Use / Additional Living Expense.
      ALIASES: "Fair Rental Value", "Coverage D", "Loss of Use", "Additional Living Expense",
               "Additional Living Expense/Fair Rental Value", "Coverage D - Fair Rental Value"
  • premises_liability_limit – Premises Liability / Personal Liability / Coverage E limit.
      ALIASES: "Premises Liability", "Personal Liability", "Liability", "Coverage E",
               "Premises Liability (per occurrence)"
      NOTE: Use "N/A" ONLY if the document explicitly excludes it or the document
            clearly does not offer liability coverage. Do NOT use "N/A" just because
            you didn't find it—use "" instead.
  • premises_liability_premium – premium for premises liability.
  • medical_payments_limit – Medical Payments / Coverage F limit.
      ALIASES: "Medical Payments", "Medical Payments to Others", "Coverage F",
               "Medical Payments (per person)"
      NOTE: If shown as "$1,000/$25,000", extract as "$1,000" (per-person limit).
  • water_backup_limit – Water Backup / Sewer / Sump Overflow limit.
      ALIASES: "Water Backup", "Water Backup and Sump Overflow", "Water Back Up",
               "Water Backup Coverage", "Limited Water Back-Up"
      NOTE: Use "N/A" ONLY if explicitly excluded. Use "" if simply not mentioned.
  • water_backup_premium – premium for water backup coverage.
  • ordinance_or_law_limit – Ordinance or Law coverage limit or percentage.
      ALIASES: "Ordinance or Law", "Ordinance Or Law"
      NOTE: May be shown as a percentage like "10%" — extract as-is.
  • extended_replacement_cost – extended replacement cost percentage or amount.
      ALIASES: "Extended Replacement Cost", "ERC"
      NOTE: May be shown as "25%" — extract as-is.

  ── Deductibles ──
  Two possible formats – fill whichever applies:

  Format 1 (separate deductibles):
  • aop_deductible       – All Other Perils / AOP deductible.
      ALIASES: "AOP", "All Other Perils", "All Other Peril Deductible", "AOP Deductible"
  • wind_hail_deductible – Wind/Hail deductible amount.
      ALIASES: "Wind/Hail", "Wind Hail", "Windstorm or Hail", "Wind/Hail Deductible",
               "Wind Hail Deductible"
      NOTE: May be a percentage like "1%" or "2% of Coverage A" — extract as-is.

  Format 2 (combined deductible):
  • deductible           – single combined deductible amount.
  • wind_hail_included   – "Yes" if wind/hail is included in the deductible, "No" if excluded, "" if not specified.
      NOTE: If there's a "Windstorm or Hail Exclusion" endorsement, set to "No".
            If separate wind/hail deductible exists, use Format 1 instead.

PREMIUM SUMMARY (array – one entry per property, in same order as properties)
• total_premium        – total policy premium. Look for "Total Premium", "Total Policy Premium", "Total Cost", "Total Amount Due".
• pay_in_full_discount – discount amount if paying in full. "" if none.
• total_if_paid_in_full – amount due if paying in full after discount. "" if same as total.

PAYMENT PLANS (combined for all properties)
For each plan (full_pay, two_pay, four_pay, monthly):
• amount_due            – amount due or down payment.
• installment_details   – description of installment schedule.
• installment_fee       – fee per installment. "" if none.
Use "" for any plan or field not offered in the quote.
ALIASES: "Full Plan"/"Full Pay"/"Pay in Full" → full_pay;
         "2-Pay Plan"/"Two Pay" → two_pay;
         "4-Pay Plan"/"Four Pay" → four_pay;
         "10-Pay Plan"/"Monthly" → monthly

─── CARRIER-SPECIFIC HINTS ─────────────────────────────────────

TOWER HILL: Rating characteristics (year built, construction type, roof year,
  occupancy, program/form) are in a small table at the BOTTOM of the first page
  labeled "Rating Characteristics:". Coverages are in "Property Coverage Information"
  and "Liability Coverage Information" sections. The "Program:" field contains the
  policy form (e.g., "DP-3").

AMERICAN MODERN: "Dwelling Details" section contains year built, construction type,
  year roof replaced. Coverages are listed as line items (Coverage A through F labels
  are NOT used—just "Dwelling", "Other Structures", etc.). "Policy Type: Dwelling Special"
  means DP3. Look on ALL pages for coverage continuation.

JOHNSON & JOHNSON (J&J) / GREAT LAKES: Coverage page shows "COVERAGE A - DWELLING (RCV)",
  "COVERAGE B - OTHER STRUCTURES", etc. with LIMIT and PREMIUM columns. "RATING FACTORS
  & UNDERWRITING INFORMATION" at the bottom of the coverage page has policy form, occupancy,
  construction type, year of construction, year of roofing updates. Also look for
  ACORD application pages which have detailed rating/underwriting checkboxes.

SAGESURE / SAFEPORT: Coverages are in a table with columns for Dwelling, Other Structures,
  Personal Property, Fair Rental Value, Personal Liability, Medical Payments, Grand Total.
  Deductibles are below the coverage table. Payment Plan Options section has Full Plan,
  2-Pay Plan, 4-Pay Plan, 10-Pay Plan. Rating & Underwriting info (year built, construction,
  roof age) is on page 2 as a text paragraph.

MARKEL / RPS / EMERALD BAY / LLOYD'S: "COVERAGE AND PREMIUM DETAILS" table has coverage limits.
  "LOCATION DETAILS" table (often page 3) has year built, construction type, occupancy,
  roof covering update year, etc. Look for "DEDUCTIBLES" section. Policy form is in the
  "Effective Date / Expiration Date / Policy Form" row.

NCJUA (North Carolina Joint Underwriting Association): Simple text layout. Coverages listed
  as "A - Dwelling $X", "B - Other Structures $X", etc. "Deductible: All Perils $X".
  Policy form is labeled "Policy Form:". Limited rating info available.

─── CONFIDENCE SCORING ──────────────────────────────────────────
For EVERY field, provide a confidence score (0.0 to 1.0) in the
"confidence" object. This object mirrors the exact same structure as the
data (flat keys, properties array, premium_summary array, payment_plans).

Scoring guide:
• 0.95–1.0  – value clearly printed / unambiguous on the document
• 0.85–0.94 – high confidence, minor ambiguity
• 0.60–0.84 – moderate confidence, inferred or partially visible
• 0.30–0.59 – low confidence, best guess from context
• 0.0–0.29  – very uncertain, field might not exist in document

For fields you set to "" (not found), rate how certain you are that the
field is genuinely ABSENT:
• 0.90+  – thoroughly searched, field is definitely not present
• 0.50–0.89 – searched but could have missed it
• <0.50  – uncertain whether the document contains this field

─── RULES ────────────────────────────────────────────────────────
• Return ONLY the JSON object. No commentary.
• If a field cannot be found, return "" for strings, [] for arrays.
• Preserve money formatting with a leading $. Examples: "$1,250.00", "$500".
• NEVER invent or guess data. If the document does not contain a value, use "".
  Returning a wrong value is MUCH worse than returning "".
• Read EVERY page of the document. Do NOT stop after the first page.
• Each property is a separate array element.
• The premium_summary array must have one entry per property in the same order.
• When a coverage shows "Included" or "Incl" as its premium, that means it is
  bundled into the main premium—do NOT put "Included" as a limit value.
"""


QUICK_PASS_PROMPT = """\
You are an accurate dwelling-insurance data extractor.
Extract fields from this dwelling insurance quote PDF.

CRITICAL: Read EVERY page of the PDF before extracting. Many fields (year built,
construction type, roof year, policy form, occupancy) are in "Rating Characteristics",
"Rating Factors & Underwriting", or "Location Details" sections that are often at the
BOTTOM of a page or on a LATER page. You MUST check those sections.

NEVER guess or fabricate. Only output a field if you can see the value printed in the
document. Omit any field you cannot find — omitting is always better than guessing wrong.

Output ONLY lines in this exact format (one per line):
field_key: value

Use these flat keys:
  named_insured, insured_property_address, carrier_name, effective_date

For agent info:
  agent_name, agent_address, agent_phone, agent_email

For properties, use numbered keys (one line each):
  property_1_property_address, property_1_year_built, property_1_construction_type,
  property_1_roof_year, property_1_occupancy, property_1_policy_form,
  property_1_dwelling_limit, property_1_dwelling_loss_settlement,
  property_1_other_structures_limit, property_1_personal_property_limit,
  property_1_personal_property_loss_settlement, property_1_personal_property_premium,
  property_1_fair_rental_value_limit, property_1_premises_liability_limit,
  property_1_premises_liability_premium, property_1_medical_payments_limit,
  property_1_water_backup_limit, property_1_water_backup_premium,
  property_1_ordinance_or_law_limit, property_1_extended_replacement_cost,
  property_1_aop_deductible, property_1_wind_hail_deductible,
  property_1_deductible, property_1_wind_hail_included
  (Use property_2_ prefix for second property, etc.)

For premium summary (per property):
  premium_1_total_premium, premium_1_pay_in_full_discount, premium_1_total_if_paid_in_full

For payment plans (full_pay, two_pay, four_pay, monthly):
  full_pay_amount_due, full_pay_installment_details, full_pay_installment_fee
  two_pay_amount_due, two_pay_installment_details, two_pay_installment_fee
  four_pay_amount_due, four_pay_installment_details, four_pay_installment_fee
  monthly_amount_due, monthly_installment_details, monthly_installment_fee

Field aliases to look for:
- dwelling_limit: "Dwelling", "Coverage A", "Coverage A - Dwelling"
- other_structures_limit: "Other Structures", "Coverage B"
- personal_property_limit: "Personal Property", "Coverage C", "Contents"
- fair_rental_value_limit: "Fair Rental Value", "Coverage D", "Loss of Use", "Additional Living Expense"
- premises_liability_limit: "Premises Liability", "Personal Liability", "Coverage E", "Liability"
- medical_payments_limit: "Medical Payments", "Medical Payments to Others", "Coverage F"
- water_backup_limit: "Water Backup", "Water Backup and Sump Overflow", "Water Back Up"
- ordinance_or_law_limit: "Ordinance or Law", "Ordinance Or Law"
- extended_replacement_cost: "Extended Replacement Cost", "ERC"
- year_built: "Year Built", "Year of Construction", "Year Dwelling Built"
- roof_year: "Roof Year", "Year Roof Replaced", "Year of Roofing Updates"

Rules:
- ONLY output values you can see in the document. NEVER guess.
- Skip fields you cannot find — do NOT make up values.
- Do not explain anything, just output key: value lines.
- construction_type must be one of: Frame, Masonry, Masonry Veneer, Fire Resistive, Superior
- policy_form: normalize to DP1, DP2, or DP3 (e.g., "DP-3" → "DP3", "Dwelling Special" → "DP3")
- dwelling_loss_settlement: "Replacement Cost"/"RCV" → "RCV"; "Actual Cash Value"/"ACV" → "ACV"
- occupancy: "Rental"/"Tenant"/"Landlord" → "Tenant Occupied"; "Owner" → "Owner Occupied"
- Use "N/A" ONLY for coverages the document explicitly excludes or does not offer.
- Monetary values must have $ prefix: "$253,534", "$2,500"
"""


# ── Helpers ──────────────────────────────────────────────────────

def flatten_confidence(conf, prefix=""):
    """Flatten nested confidence object to dot-path keys with float values."""
    result = {}
    if not isinstance(conf, dict):
        return result
    for k, v in conf.items():
        path = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            result.update(flatten_confidence(v, path))
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    result.update(flatten_confidence(item, f"{path}.{i}"))
                elif isinstance(item, (int, float)):
                    result[f"{path}.{i}"] = float(item)
        elif isinstance(v, (int, float)):
            result[path] = float(v)
    return result


def _normalize_field_value(key: str, value: str) -> str:
    """Post-process individual field values to normalize common variations."""
    if not isinstance(value, str) or not value.strip():
        return value

    v = value.strip()

    # ── Policy form normalization ──
    if key == "policy_form":
        upper = v.upper().replace("-", "").replace(" ", "")
        if upper in ("DP1",):
            return "DP1"
        if upper in ("DP2",):
            return "DP2"
        if upper in ("DP3", "DWELLINGSPECIAL", "DWELLINGPROPERTY(DP3)"):
            return "DP3"
        # Check for DP form embedded in longer text
        for form in ("DP3", "DP2", "DP1"):
            if form in v.upper().replace("-", "").replace(" ", ""):
                return form
        return v

    # ── Occupancy normalization ──
    if key == "occupancy":
        lower = v.lower()
        if any(t in lower for t in ("rental", "tenant", "landlord", "renter")):
            return "Tenant Occupied"
        if any(t in lower for t in ("owner", "primary")):
            return "Owner Occupied"
        if "secondary" in lower or "seasonal" in lower:
            return "Secondary Home"
        if "vacant" in lower:
            return "Vacant"
        return v

    # ── Loss settlement normalization ──
    if key in ("dwelling_loss_settlement", "personal_property_loss_settlement"):
        lower = v.lower()
        if "replacement" in lower or lower == "rcv":
            return "RCV"
        if "actual cash" in lower or lower == "acv":
            return "ACV"
        return v

    # ── Construction type normalization ──
    if key == "construction_type":
        lower = v.lower()
        if "frame" in lower or "wood" in lower or "vinyl" in lower:
            return "Frame"
        if "veneer" in lower:
            return "Masonry Veneer"
        if "masonry" in lower or "brick" in lower:
            return "Masonry"
        if "fire res" in lower:
            return "Fire Resistive"
        if "superior" in lower:
            return "Superior"
        return v

    # ── Wind/hail included normalization ──
    if key == "wind_hail_included":
        lower = v.lower()
        if lower in ("yes", "true", "y", "included"):
            return "Yes"
        if lower in ("no", "false", "n", "excluded"):
            return "No"
        return v

    return v


def normalize_dwelling_result(parsed: dict) -> tuple:
    """Ensure every expected key exists and normalize values. Returns (data_dict, flat_confidence_dict)."""
    raw_confidence = parsed.pop("confidence", {})

    # Flat keys
    for k in FLAT_KEYS:
        parsed.setdefault(k, "")
        if parsed[k] is None:
            parsed[k] = ""

    # Agent keys
    for k in AGENT_KEYS:
        parsed.setdefault(k, "")
        if parsed[k] is None:
            parsed[k] = ""

    # Properties
    properties = parsed.get("properties") or []
    all_prop_keys = PROPERTY_INFO_KEYS + COVERAGE_KEYS + DEDUCTIBLE_V1_KEYS + DEDUCTIBLE_V2_KEYS
    for prop in properties:
        for k in all_prop_keys:
            prop.setdefault(k, "")
            if prop[k] is None:
                prop[k] = ""
            # Apply field-level normalization
            prop[k] = _normalize_field_value(k, prop[k])
    parsed["properties"] = properties

    # Premium summary
    premium_summary = parsed.get("premium_summary") or []
    for ps in premium_summary:
        for k in PREMIUM_KEYS:
            ps.setdefault(k, "")
            if ps[k] is None:
                ps[k] = ""
    parsed["premium_summary"] = premium_summary

    # Payment plans
    pp = parsed.get("payment_plans") or {}
    for plan in PLAN_NAMES:
        p = pp.get(plan) or {}
        pp[plan] = {k: p.get(k, "") or "" for k in PAYMENT_PLAN_KEYS}
    parsed["payment_plans"] = pp

    # Flatten confidence
    flat_confidence = flatten_confidence(raw_confidence)

    return parsed, flat_confidence


def extract_quick_pass_lines(text: str) -> dict:
    """Parse key:value lines from Pass 1 into a nested form-shaped dict."""
    raw = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value:
            raw[key] = value

    result = {}

    # Flat fields
    for k in FLAT_KEYS:
        if k in raw:
            result[k] = raw[k]

    # Agent fields
    for k in AGENT_KEYS:
        if k in raw:
            result[k] = raw[k]

    # Properties (numbered: property_1_dwelling_limit, property_2_year_built, etc.)
    all_prop_fields = (
        PROPERTY_INFO_KEYS + COVERAGE_KEYS + DEDUCTIBLE_V1_KEYS + DEDUCTIBLE_V2_KEYS
    )
    property_map = {}
    for rk, rv in raw.items():
        m = re.match(r"property_(\d+)_(\w+)", rk)
        if m:
            idx = int(m.group(1)) - 1
            field = m.group(2)
            if field in all_prop_fields:
                property_map.setdefault(idx, {})
                property_map[idx][field] = rv
    if property_map:
        max_idx = max(property_map.keys())
        properties = []
        for i in range(max_idx + 1):
            p = property_map.get(i, {})
            prop = {k: _normalize_field_value(k, p.get(k, "")) for k in all_prop_fields}
            properties.append(prop)
        result["properties"] = properties

    # Premium summary (numbered: premium_1_total_premium, etc.)
    premium_map = {}
    for rk, rv in raw.items():
        m = re.match(r"premium_(\d+)_(\w+)", rk)
        if m:
            idx = int(m.group(1)) - 1
            field = m.group(2)
            if field in PREMIUM_KEYS:
                premium_map.setdefault(idx, {})
                premium_map[idx][field] = rv
    if premium_map:
        max_idx = max(premium_map.keys())
        premiums = []
        for i in range(max_idx + 1):
            ps = premium_map.get(i, {})
            premiums.append({k: ps.get(k, "") for k in PREMIUM_KEYS})
        result["premium_summary"] = premiums

    # Payment plans (prefixed: full_pay_amount_due, monthly_installment_fee, etc.)
    payment_plans = {}
    for plan in PLAN_NAMES:
        plan_data = {}
        for pk in PAYMENT_PLAN_KEYS:
            combo_key = f"{plan}_{pk}"
            if combo_key in raw:
                plan_data[pk] = raw[combo_key]
        if plan_data:
            payment_plans[plan] = plan_data
    if payment_plans:
        result["payment_plans"] = payment_plans

    return result


def extract_partial_json_root(streamed_json: str) -> dict:
    """Try to parse (possibly incomplete) JSON from Pass 2 streaming."""
    try:
        return json.loads(streamed_json)
    except Exception:
        pass

    start = streamed_json.find("{")
    end = streamed_json.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = streamed_json[start : end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return {}

    return {}


# ── Streaming pipeline ───────────────────────────────────────────

def stream_dwelling_quote_with_gemini(
    pdf_path: Path,
    model_quick: str = "gemini-2.5-flash-lite",
    model_final: str = "gemini-2.5-flash",
) -> Iterator[str]:
    client = get_gemini_client()
    uploaded_file = None

    try:
        uploaded_file = client.files.upload(
            file=str(pdf_path),
            config={"mime_type": "application/pdf"},
        )

        sent_draft_json = ""

        yield json.dumps({"type": "status", "message": "Reading dwelling quote..."}) + "\n"

        # ── PASS 1: quick draft extraction (key:value lines) ─────
        quick_text = ""
        quick_stream = client.models.generate_content_stream(
            model=model_quick,
            contents=[
                "Read ALL pages of this dwelling insurance quote PDF carefully. "
                "Extract every field you can find. Pay special attention to "
                "Rating Characteristics, Rating Factors, Underwriting, and Location Details "
                "sections — these contain year built, construction type, roof year, occupancy, "
                "and policy form. Only output values you can actually see in the document.",
                uploaded_file,
            ],
            config=types.GenerateContentConfig(
                system_instruction=QUICK_PASS_PROMPT,
                temperature=0,
            ),
        )

        for chunk in quick_stream:
            text = chunk.text or ""
            if not text:
                continue

            quick_text += text
            patch = extract_quick_pass_lines(quick_text)

            if patch:
                patch_json = json.dumps(patch, sort_keys=True)
                if patch_json != sent_draft_json:
                    sent_draft_json = patch_json
                    yield json.dumps({
                        "type": "draft_patch",
                        "data": patch,
                    }) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted dwelling fields..."}) + "\n"

        # ── PASS 2: strict structured extraction ─────────────────
        full_text = ""
        sent_final_json = ""

        final_stream = client.models.generate_content_stream(
            model=model_final,
            contents=[
                "Read ALL pages of this dwelling insurance quote PDF thoroughly. "
                "Extract every field into the JSON schema. "
                "IMPORTANT: Check the Rating Characteristics, Rating Factors & Underwriting, "
                "Location Details, and Dwelling Details sections (often at the bottom of "
                "pages or on later pages) for year_built, construction_type, roof_year, "
                "occupancy, and policy_form. "
                "For coverages, look for Coverage A/B/C/D labels or Dwelling/Other Structures/"
                "Personal Property/Fair Rental Value line items. "
                "NEVER guess — only extract values explicitly shown in the document.",
                uploaded_file,
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=DWELLING_SCHEMA,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue

            full_text += text
            partial = extract_partial_json_root(full_text)

            if partial:
                # Strip confidence from incremental patches
                partial.pop("confidence", None)
                partial_json = json.dumps(partial, sort_keys=True)
                if partial_json != sent_final_json:
                    sent_final_json = partial_json
                    yield json.dumps({
                        "type": "final_patch",
                        "data": partial,
                    }) + "\n"

        parsed = json.loads(full_text)
        data, confidence = normalize_dwelling_result(parsed)

        yield json.dumps({
            "type": "result",
            "data": data,
            "confidence": confidence,
        }) + "\n"

    except Exception as exc:
        yield json.dumps({"type": "error", "error": str(exc)}) + "\n"

    finally:
        if uploaded_file is not None:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass


@router.post("/api/parse-dwelling-quote")
async def parse_dwelling_quote(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await file.read())

    def event_stream():
        try:
            yield from stream_dwelling_quote_with_gemini(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
    )
