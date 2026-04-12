# auto_parser_api.py
# Uses Gemini Flash 2.5
# 2-pass extraction for auto insurance quotes:
#   Pass 1 = fast draft with gemini-2.5-flash-lite  (key:value streaming)
#   Pass 2 = strict structured JSON with gemini-2.5-flash
# Field mapping matches frontend autoConfig.js exactly.

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

from pdf_storage_helpers import store_uploaded_pdf

from parsers._model_fallback import (
    DEFAULT_FINAL_FALLBACKS,
    DEFAULT_QUICK_FALLBACKS,
    stream_with_fallback,
    upload_with_retry,
)
from parsers._openai_fallback import stream_openai_extraction

load_dotenv()

router = APIRouter()


def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set. Add it to your .env file or environment.")
    return genai.Client(api_key=api_key)


# ── Flat top-level keys the AI must return ───────────────────────
FLAT_KEYS = [
    "client_name",
    "client_address",
    "client_phone",
    "quote_date",
    "quote_effective_date",
    "quote_expiration_date",
    "policy_term",
]

COVERAGE_KEYS = [
    "bi_limit",
    "pd_limit",
    "medpay_limit",
    "um_uim_bi_limit",
    "umpd_limit",
    "umpd_deductible",
    "comprehensive_deductible",
    "collision_deductible",
    "rental_limit",
    "towing_limit",
]

VEHICLE_PREMIUM_KEYS = [
    "bi_premium",
    "pd_premium",
    "medpay_premium",
    "um_uim_bi_premium",
    "umpd_premium",
    "comprehensive_premium",
    "collision_premium",
    "rental_premium",
    "towing_premium",
]

FULL_PAY_KEYS = ["full_pay_amount", "eft_reduces_fee"]
INSTALLMENT_PLAN_KEYS = [
    "down_payment",
    "amount_per_installment",
    "number_of_installments",
    "eft_reduces_fee",
]
INSTALLMENT_PLAN_NAMES = ["semi_annual", "quarterly", "monthly"]
PLAN_NAMES = ["full_pay"] + INSTALLMENT_PLAN_NAMES
PIF_DISCOUNT_KEYS = ["gross_premium", "discount_amount", "net_pay_in_full"]
PREMIUM_SUMMARY_KEYS = ["total_premium", "paid_in_full_discount", "total_pay_in_full"]


def _plan_keys(plan: str) -> list:
    return FULL_PAY_KEYS if plan == "full_pay" else INSTALLMENT_PLAN_KEYS


# ── Gemini structured-output schema (Pass 2) ────────────────────
AUTO_SCHEMA = {
    "type": "object",
    "properties": {
        # S1 – Auto Policy
        "client_name": {"type": "string"},
        "client_address": {"type": "string"},
        "client_phone": {"type": "string"},
        "quote_date": {"type": "string"},
        "quote_effective_date": {"type": "string"},
        "quote_expiration_date": {"type": "string"},
        "policy_term": {"type": "string", "enum": ["6-Month", "12-Month", "Unknown"]},

        # S3 – Drivers
        "drivers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "driver_name": {"type": "string"},
                    "gender": {"type": "string", "enum": ["Male", "Female", "Unknown"]},
                    "marital_status": {"type": "string"},
                    "license_state": {"type": "string"},
                },
                "required": ["driver_name", "gender", "marital_status", "license_state"],
            },
        },

        # S4 – Vehicles
        "vehicles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "year_make_model_trim": {"type": "string"},
                    "vin": {"type": "string"},
                    "vehicle_use": {"type": "string"},
                    "garaging_zip_county": {"type": "string"},
                    "coverage_premiums": {
                        "type": "object",
                        "properties": {k: {"type": "string"} for k in VEHICLE_PREMIUM_KEYS},
                        "required": VEHICLE_PREMIUM_KEYS,
                    },
                    "subtotal": {"type": "string"},
                },
                "required": [
                    "year_make_model_trim", "vin", "vehicle_use",
                    "garaging_zip_county", "coverage_premiums", "subtotal",
                ],
            },
        },

        # S5 – Coverages (limits / deductibles)
        "coverages": {
            "type": "object",
            "properties": {k: {"type": "string"} for k in COVERAGE_KEYS},
            "required": COVERAGE_KEYS,
        },

        # S6 – Payment Options
        "payment_options": {
            "type": "object",
            "properties": {
                "full_pay": {
                    "type": "object",
                    "properties": {k: {"type": "string"} for k in FULL_PAY_KEYS},
                    "required": FULL_PAY_KEYS,
                },
                **{
                    plan: {
                        "type": "object",
                        "properties": {k: {"type": "string"} for k in INSTALLMENT_PLAN_KEYS},
                        "required": INSTALLMENT_PLAN_KEYS,
                    }
                    for plan in INSTALLMENT_PLAN_NAMES
                },
                "paid_in_full_discount": {
                    "type": "object",
                    "properties": {k: {"type": "string"} for k in PIF_DISCOUNT_KEYS},
                    "required": PIF_DISCOUNT_KEYS,
                },
            },
            "required": PLAN_NAMES + ["paid_in_full_discount"],
        },

        # S7 – Premium Summary
        "premium_summary": {
            "type": "object",
            "properties": {
                "vehicle_subtotals": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                **{k: {"type": "string"} for k in PREMIUM_SUMMARY_KEYS},
            },
            "required": ["vehicle_subtotals"] + PREMIUM_SUMMARY_KEYS,
        },
    },
    "required": [
        "client_name", "client_address", "client_phone",
        "quote_date", "quote_effective_date", "quote_expiration_date",
        "policy_term",
        "drivers", "vehicles", "coverages",
        "payment_options", "premium_summary",
    ],
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


# Add confidence object to schema (mirrors data structure with numbers 0-1)
_data_props = dict(AUTO_SCHEMA["properties"])
AUTO_SCHEMA["properties"]["confidence"] = {
    "type": "object",
    "properties": {k: _to_confidence_type(v) for k, v in _data_props.items()},
    "required": list(_data_props.keys()),
}
AUTO_SCHEMA["required"].append("confidence")


# ── Prompts ──────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert auto-insurance data extractor. You receive a scanned or
digital auto insurance quote / proposal / submission PDF and return a single
JSON object that maps exactly to the schema provided.

─── FIELD GUIDANCE ───────────────────────────────────────────────

POLICY INFO
• client_name        – the insured / applicant / named insured, NOT the agency.
• client_address     – single-line mailing address.
• client_phone       – insured's phone if shown.
• quote_date         – the print date, quote date, or proposal date shown on
                       the document. Use MM/DD/YYYY format.
• quote_effective_date / quote_expiration_date – policy effective & expiration
                       dates. Use MM/DD/YYYY.
• policy_term        – MUST be exactly "6-Month", "12-Month", or "Unknown".
                       Determine from the effective/expiration date span if not
                       stated explicitly. A ~180-day span = "6-Month",
                       ~365-day span = "12-Month". Use "Unknown" only if it
                       truly cannot be determined.

DRIVERS  (array – capture ALL listed drivers)
• driver_name        – full name.
• gender             – "Male", "Female", or "Unknown" if not stated.
• marital_status     – e.g. "Single", "Married", "Divorced".  "" if absent.
• license_state      – two-letter state abbreviation (e.g. "VA", "MD").

VEHICLES  (array – capture ALL listed vehicles)
• year_make_model_trim – combine year, make, model, and trim into one string,
                         e.g. "2021 Toyota Camry LE".
• vin                – full 17-character VIN.  "" if not shown.
• vehicle_use        – e.g. "Commute", "Pleasure", "Business".  "" if absent.
• garaging_zip_county – ZIP code and/or county where the vehicle is garaged.
• coverage_premiums  – an object with one key per coverage type containing the
                       premium dollar amount for THIS vehicle:
    bi_premium, pd_premium, medpay_premium, um_uim_bi_premium, umpd_premium,
    comprehensive_premium, collision_premium, rental_premium, towing_premium.
    Use "" for any premium not listed.
• subtotal           – total premium for this vehicle (sum of its coverage
                       premiums). If the document shows the subtotal directly,
                       use that value.

COVERAGES  (policy-level limits & deductibles – one value each, NOT per-vehicle)
• bi_limit           – Bodily Injury split limit, e.g. "$100,000 / $300,000".
• pd_limit           – Property Damage limit, e.g. "$100,000".
• medpay_limit       – Medical Payments limit. "N/A" if not offered.
• um_uim_bi_limit    – Uninsured / Underinsured Motorist BI split limit,
                       e.g. "$100,000 / $300,000".
                       Check BOTH vehicle-level AND policy-level sections.
• umpd_limit         – UM Property Damage limit. "N/A" if not offered.
• umpd_deductible    – UMPD deductible. "N/A" if not applicable.
• comprehensive_deductible – may be labeled "Other Than Collision" or "OTC".
• collision_deductible     – collision deductible amount.
• rental_limit       – Rental / Transportation expense limit. "N/A" if absent.
• towing_limit       – Towing & Labor / Roadside limit. "N/A" if absent.

PAYMENT OPTIONS
full_pay (the pay-in-full option):
• full_pay_amount  – the single full-pay amount the insured would pay if
                     they pay the entire policy term up front.
• eft_reduces_fee  – "Yes", "No", or the reduced amount if shown for EFT/
                     Auto-Pay on the full-pay plan.
For each installment plan (semi_annual, quarterly, monthly):
• down_payment            – required down payment amount.
• amount_per_installment  – the amount due per installment after the down
                            payment (e.g. monthly payment).
• number_of_installments  – the count of installments after the down payment
                            (digits only, e.g. "5", "11").
• eft_reduces_fee         – "Yes", "No", or the reduced amount if EFT/Auto-Pay
                            reduces installment fees on this plan.
Use "" for any plan or field not offered in the quote.

paid_in_full_discount (only populate if the carrier offers a pay-in-full
discount; otherwise leave all fields ""):
• gross_premium    – premium before discount.
• discount_amount  – the discount, use a leading minus, e.g. "-$50".
• net_pay_in_full  – net amount after discount.

PREMIUM SUMMARY
• vehicle_subtotals       – array of strings, one subtotal per vehicle in order.
• total_premium           – the grand-total premium for the policy term.
• paid_in_full_discount   – discount amount if paying in full. "" if none.
• total_pay_in_full       – amount due if paying in full after discount.

─── CONFIDENCE SCORING ──────────────────────────────────────────
For EVERY field, provide a confidence score (0.0 to 1.0) in the
"confidence" object. This object mirrors the exact same structure as the
data (flat keys, drivers array, vehicles array, coverages object, etc.).

Scoring guide:
• 0.95–1.0  – value clearly printed / unambiguous on the document
• 0.85–0.94 – high confidence, minor ambiguity (e.g., slightly blurry)
• 0.60–0.84 – moderate confidence, inferred or partially visible
• 0.30–0.59 – low confidence, best guess from context
• 0.0–0.29  – very uncertain, field might not exist in document

For fields you set to "" (not found), the confidence score rates how
certain you are that the field is genuinely ABSENT from the document:
• 0.90+  – thoroughly searched, field is definitely not present
• 0.50–0.89 – searched but could have missed it or it might be elsewhere
• <0.50  – uncertain whether the document contains this field

─── RULES ────────────────────────────────────────────────────────
• Return ONLY the JSON object. No commentary.
• If a field cannot be found, return "" for strings, [] for arrays.
• Preserve money formatting with a leading $. Examples: "$1,250.00", "$500".
• Split limits must use the " / " separator: "$X / $Y".
• Do NOT invent data. If the document does not contain a value, use "".
• Each driver and vehicle is a separate array element.
• Keep per-vehicle coverage premiums attached to the correct vehicle.
"""


QUICK_PASS_PROMPT = """\
You are a fast auto-insurance data extractor.
Extract fields from this auto insurance quote PDF as quickly as possible.

Output ONLY lines in this exact format (one per line):
field_key: value

Use these flat keys:
  client_name, client_address, client_phone, quote_date,
  quote_effective_date, quote_expiration_date, policy_term

For coverage limits/deductibles use these keys:
  bi_limit, pd_limit, medpay_limit, um_uim_bi_limit, umpd_limit,
  umpd_deductible, comprehensive_deductible, collision_deductible,
  rental_limit, towing_limit

For premium summary use:
  total_premium, paid_in_full_discount, total_pay_in_full

For drivers, use numbered keys (one line each):
  driver_1_name, driver_1_gender, driver_1_marital_status, driver_1_license_state
  driver_2_name, driver_2_gender, ...

For vehicles, use numbered keys:
  vehicle_1_year_make_model_trim, vehicle_1_vin, vehicle_1_vehicle_use,
  vehicle_1_garaging_zip_county, vehicle_1_subtotal
  vehicle_2_year_make_model_trim, ...

For payment plans:
  full_pay_full_pay_amount, full_pay_eft_reduces_fee
  semi_annual_down_payment, semi_annual_amount_per_installment, semi_annual_number_of_installments, semi_annual_eft_reduces_fee
  quarterly_down_payment, quarterly_amount_per_installment, quarterly_number_of_installments, quarterly_eft_reduces_fee
  monthly_down_payment, monthly_amount_per_installment, monthly_number_of_installments, monthly_eft_reduces_fee

Rules:
- Skip fields you cannot identify.
- Do not explain anything.
- Prefer speed over perfection.
- policy_term must be "6-Month", "12-Month", or "Unknown".
- bi_limit and um_uim_bi_limit are split limits: "$X / $Y".
- Use "N/A" for coverages clearly not offered.
- For names, always format as "First Last", never "Last, First"
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


def normalize_auto_result(parsed: dict) -> tuple:
    """Ensure every expected key exists. Returns (data_dict, flat_confidence_dict)."""
    # Extract confidence before normalizing data fields
    raw_confidence = parsed.pop("confidence", {})

    for k in FLAT_KEYS:
        parsed.setdefault(k, "")
        if parsed[k] is None:
            parsed[k] = ""
    # Convert enum placeholders back to empty strings for the frontend
    if parsed.get("policy_term") == "Unknown":
        parsed["policy_term"] = ""

    # Drivers
    drivers = parsed.get("drivers") or []
    for d in drivers:
        for k in ("driver_name", "gender", "marital_status", "license_state"):
            d.setdefault(k, "")
        if d.get("gender") == "Unknown":
            d["gender"] = ""
    parsed["drivers"] = drivers

    # Vehicles
    vehicles = parsed.get("vehicles") or []
    for v in vehicles:
        for k in ("year_make_model_trim", "vin", "vehicle_use", "garaging_zip_county", "subtotal"):
            v.setdefault(k, "")
        cp = v.get("coverage_premiums") or {}
        v["coverage_premiums"] = {k: cp.get(k, "") for k in VEHICLE_PREMIUM_KEYS}
    parsed["vehicles"] = vehicles

    # Coverages
    cov = parsed.get("coverages") or {}
    parsed["coverages"] = {k: cov.get(k, "") for k in COVERAGE_KEYS}

    # Payment options
    po = parsed.get("payment_options") or {}
    for plan in PLAN_NAMES:
        p = po.get(plan) or {}
        po[plan] = {k: p.get(k, "") for k in _plan_keys(plan)}
    pif = po.get("paid_in_full_discount") or {}
    po["paid_in_full_discount"] = {k: pif.get(k, "") for k in PIF_DISCOUNT_KEYS}
    # Set show flag if any PIF discount data was extracted
    has_pif = any(po["paid_in_full_discount"][k] for k in PIF_DISCOUNT_KEYS)
    po["show_paid_in_full_discount"] = has_pif
    parsed["payment_options"] = po

    # Premium summary
    ps = parsed.get("premium_summary") or {}
    vs = ps.get("vehicle_subtotals") or []
    parsed["premium_summary"] = {
        "vehicle_subtotals": [str(s) if s else "" for s in vs],
        **{k: ps.get(k, "") for k in PREMIUM_SUMMARY_KEYS},
    }

    # Flatten confidence to dot-path keys
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

    # Coverages
    coverages = {}
    for k in COVERAGE_KEYS:
        if k in raw:
            coverages[k] = raw[k]
    if coverages:
        result["coverages"] = coverages

    # Drivers (numbered: driver_1_name, driver_2_gender, etc.)
    driver_map = {}
    driver_fields = {"name": "driver_name", "gender": "gender",
                     "marital_status": "marital_status", "license_state": "license_state"}
    for rk, rv in raw.items():
        m = re.match(r"driver_(\d+)_(\w+)", rk)
        if m:
            idx = int(m.group(1)) - 1
            field_suffix = m.group(2)
            mapped = driver_fields.get(field_suffix)
            if mapped:
                driver_map.setdefault(idx, {})
                driver_map[idx][mapped] = rv
    if driver_map:
        max_idx = max(driver_map.keys())
        drivers = []
        for i in range(max_idx + 1):
            d = driver_map.get(i, {})
            drivers.append({
                "driver_name": d.get("driver_name", ""),
                "gender": d.get("gender", ""),
                "marital_status": d.get("marital_status", ""),
                "license_state": d.get("license_state", ""),
            })
        result["drivers"] = drivers

    # Vehicles (numbered: vehicle_1_vin, etc.)
    vehicle_map = {}
    vehicle_fields = {
        "year_make_model_trim": "year_make_model_trim",
        "vin": "vin",
        "vehicle_use": "vehicle_use",
        "garaging_zip_county": "garaging_zip_county",
        "subtotal": "subtotal",
    }
    for rk, rv in raw.items():
        m = re.match(r"vehicle_(\d+)_(\w+)", rk)
        if m:
            idx = int(m.group(1)) - 1
            field_suffix = m.group(2)
            mapped = vehicle_fields.get(field_suffix)
            if mapped:
                vehicle_map.setdefault(idx, {})
                vehicle_map[idx][mapped] = rv
    if vehicle_map:
        max_idx = max(vehicle_map.keys())
        vehicles = []
        for i in range(max_idx + 1):
            v = vehicle_map.get(i, {})
            vehicles.append({
                "year_make_model_trim": v.get("year_make_model_trim", ""),
                "vin": v.get("vin", ""),
                "vehicle_use": v.get("vehicle_use", ""),
                "garaging_zip_county": v.get("garaging_zip_county", ""),
                "coverage_premiums": {k: "" for k in VEHICLE_PREMIUM_KEYS},
                "subtotal": v.get("subtotal", ""),
            })
        result["vehicles"] = vehicles

    # Payment options (prefixed by plan name).
    # full_pay  → full_pay_full_pay_amount, full_pay_eft_reduces_fee
    # installments → <plan>_down_payment, <plan>_amount_per_installment,
    #                <plan>_number_of_installments, <plan>_eft_reduces_fee
    payment_options = {}
    for plan in PLAN_NAMES:
        plan_data = {}
        for pk in _plan_keys(plan):
            combo_key = f"{plan}_{pk}"
            if combo_key in raw:
                plan_data[pk] = raw[combo_key]
        if plan_data:
            payment_options[plan] = plan_data
    if payment_options:
        result["payment_options"] = payment_options

    # Premium summary
    ps = {}
    for k in PREMIUM_SUMMARY_KEYS:
        if k in raw:
            ps[k] = raw[k]
    if ps:
        result["premium_summary"] = ps

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

def stream_auto_quote_with_gemini(
    pdf_path: Path,
    model_quick: str = "gemini-2.5-flash-lite",
    model_final: str = "gemini-2.5-flash",
    model_quick_fallback=DEFAULT_QUICK_FALLBACKS,
    model_final_fallback=DEFAULT_FINAL_FALLBACKS,
) -> Iterator[str]:
    client = get_gemini_client()
    uploaded_file = None

    try:
        uploaded_file = upload_with_retry(
            client,
            file=str(pdf_path),
            config={"mime_type": "application/pdf"},
        )

        sent_draft_json = ""

        yield json.dumps({"type": "status", "message": "Reading auto quote..."}) + "\n"

        # ── PASS 1: quick draft extraction (key:value lines) ─────
        quick_text = ""
        quick_user_prompt = "Quickly extract likely fields from this auto insurance quote PDF."
        quick_stream = stream_with_fallback(
            client,
            model_quick,
            model_quick_fallback,
            contents=[quick_user_prompt, uploaded_file],
            config=types.GenerateContentConfig(
                system_instruction=QUICK_PASS_PROMPT,
                temperature=0,
            ),
            openai_fallback=lambda: stream_openai_extraction(
                pdf_path,
                system_instruction=QUICK_PASS_PROMPT,
                user_prompt=quick_user_prompt,
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

        # ── Draft "Why Selected" (runs concurrently-ish after pass 1) ──
        draft_data = json.loads(sent_draft_json) if sent_draft_json else {}
        from why_selected_generator import generate_why_selected_draft, generate_why_selected_refine
        draft_bullets = generate_why_selected_draft(draft_data, "auto")
        if draft_bullets:
            yield json.dumps({"type": "draft_patch", "data": {"why_selected": draft_bullets}}) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted auto fields..."}) + "\n"

        # ── PASS 2: strict structured extraction ─────────────────
        full_text = ""
        sent_final_json = ""

        final_user_prompt = "Extract the auto insurance quote fields from this PDF."
        final_stream = stream_with_fallback(
            client,
            model_final,
            model_final_fallback,
            contents=[final_user_prompt, uploaded_file],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=AUTO_SCHEMA,
            ),
            openai_fallback=lambda: stream_openai_extraction(
                pdf_path,
                system_instruction=SYSTEM_PROMPT,
                user_prompt=(
                    final_user_prompt
                    + " Return ONLY a valid JSON object matching the schema "
                    "described in the system prompt. No prose, no markdown "
                    "code fences — just the JSON object."
                ),
                json_schema=AUTO_SCHEMA,
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
        data, confidence = normalize_auto_result(parsed)

        # Refine "Why This Plan Was Selected" bullets using final data
        yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
        data["why_selected"] = generate_why_selected_refine(data, draft_bullets, "auto")

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


@router.post("/api/parse-auto-quote")
async def parse_auto_quote(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    file_bytes = await file.read()

    # Store uploaded PDF in database (fire-and-forget)
    try:
        await store_uploaded_pdf(
            file_data=file_bytes,
            file_name=file.filename or "auto_quote.pdf",
            insurance_type="auto",
        )
    except Exception:
        pass

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(file_bytes)

    def event_stream():
        try:
            yield from stream_auto_quote_with_gemini(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
    )
