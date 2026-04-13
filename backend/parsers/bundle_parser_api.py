# bundle_parser_api.py
# Uses Gemini Flash 2.5
# 2-pass extraction for bundle (homeowners + auto) insurance quotes:
#   Pass 1 = fast draft with gemini-2.5-flash-lite  (key:value streaming)
#   Pass 2 = strict structured JSON with gemini-2.5-flash
# Field mapping matches frontend bundleConfig.js exactly.

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Iterator

from typing import List

from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

from pdf_storage_helpers import store_uploaded_pdf

from parsers._model_fallback import (
    DEFAULT_FINAL_FALLBACKS,
    DEFAULT_QUICK_FALLBACKS,
    generate_with_fallback,
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


# ── Key definitions ───────────────────────────────────────────────

# Shared client/policy keys
BUNDLE_POLICY_KEYS = [
    "bundle_total_premium",
    "home_premium",
    "auto_premium",
    "quote_date",
    "quote_effective_date",
    "quote_expiration_date",
    "client_name",
    "client_address",
    "client_email",
    "client_phone",
]

# Homeowners coverage keys
HOMEOWNERS_COVERAGE_KEYS = [
    "dwelling",
    "other_structures",
    "personal_property",
    "loss_of_use",
    "personal_liability",
    "medical_payments",
    "replacement_cost_on_contents",
    "25_extended_replacement_cost",
    "all_perils_deductible",
    "wind_hail_deductible",
    "water_and_sewer_backup",
]

# Auto policy detail keys (prefixed with auto_)
AUTO_POLICY_KEYS = [
    "auto_policy_term",
]

# Auto coverage keys
AUTO_COVERAGE_KEYS = [
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
# Back-compat: union of all keys (used by old callers if any)
PAYMENT_PLAN_KEYS = FULL_PAY_KEYS + INSTALLMENT_PLAN_KEYS
PIF_DISCOUNT_KEYS = ["gross_premium", "discount_amount", "net_pay_in_full"]


def _plan_keys(plan: str) -> list:
    return FULL_PAY_KEYS if plan == "full_pay" else INSTALLMENT_PLAN_KEYS

ALL_FLAT_KEYS = BUNDLE_POLICY_KEYS + HOMEOWNERS_COVERAGE_KEYS + AUTO_POLICY_KEYS

YES_NO_FIELDS = {"replacement_cost_on_contents", "25_extended_replacement_cost"}


# ── Gemini structured-output schema (Pass 2) ────────────────────

BUNDLE_SCHEMA = {
    "type": "object",
    "properties": {
        # Bundle policy premiums
        "bundle_total_premium": {"type": "string"},
        "home_premium": {"type": "string"},
        "auto_premium": {"type": "string"},

        # Bundle quote dates
        "quote_date": {"type": "string"},
        "quote_effective_date": {"type": "string"},
        "quote_expiration_date": {"type": "string"},

        # Client info
        "client_name": {"type": "string"},
        "client_address": {"type": "string"},
        "client_email": {"type": "string"},
        "client_phone": {"type": "string"},

        # Homeowners coverages
        "dwelling": {"type": "string"},
        "other_structures": {"type": "string"},
        "personal_property": {"type": "string"},
        "loss_of_use": {"type": "string"},
        "personal_liability": {"type": "string"},
        "medical_payments": {"type": "string"},
        "replacement_cost_on_contents": {
            "type": "string",
            "enum": ["Yes", "No"],
        },
        "25_extended_replacement_cost": {
            "type": "string",
            "enum": ["Yes", "No"],
        },
        "all_perils_deductible": {"type": "string"},
        "wind_hail_deductible": {"type": "string"},
        "water_and_sewer_backup": {"type": "string"},

        # Auto policy details
        "auto_policy_term": {"type": "string", "enum": ["6-Month", "12-Month", "Unknown"]},

        # Auto drivers
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

        # Auto vehicles
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

        # Auto coverages (limits/deductibles)
        "coverages": {
            "type": "object",
            "properties": {k: {"type": "string"} for k in AUTO_COVERAGE_KEYS},
            "required": AUTO_COVERAGE_KEYS,
        },

        # Auto payment options
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

        # Confidence scores
        "confidence": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in ALL_FLAT_KEYS + AUTO_COVERAGE_KEYS},
            "required": ALL_FLAT_KEYS + AUTO_COVERAGE_KEYS,
        },
    },
    "required": [
        "bundle_total_premium", "home_premium", "auto_premium",
        "quote_date", "quote_effective_date", "quote_expiration_date",
        "client_name", "client_address", "client_email", "client_phone",
        "dwelling", "other_structures", "personal_property", "loss_of_use",
        "personal_liability", "medical_payments",
        "all_perils_deductible", "wind_hail_deductible", "water_and_sewer_backup",
        "auto_policy_term",
        "drivers", "vehicles", "coverages", "payment_options",
        "confidence",
    ],
}


# ── Prompts ──────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert insurance data extractor. You receive a BUNDLE insurance
quote PDF that contains BOTH homeowners and auto coverage in a single document.
Return a single JSON object matching the schema provided.

─── BUNDLE POLICY PREMIUMS ──────────────────────────────────────
• bundle_total_premium – the grand total premium for both home + auto combined.
• home_premium         – the homeowners portion of the premium.
• auto_premium         – the auto portion of the premium.

─── BUNDLE QUOTE DATES ──────────────────────────────────────────
• quote_date            – print/quote date in MM/DD/YYYY (the date the quote
  was generated). Aliases: "Quote Date", "Print Date", "Date".
• quote_effective_date  – effective/start date in MM/DD/YYYY.
• quote_expiration_date – expiration/end date in MM/DD/YYYY.
If the bundle quote shows separate home vs auto dates, use the bundle-level
or homeowners dates here. (Auto-specific dates still go in auto_quote_*.)

─── CLIENT INFORMATION ──────────────────────────────────────────
• client_name    – the insured / applicant / named insured, NOT the agency.
• client_address – single-line mailing address.
• client_email   – email if shown. "" if absent.
• client_phone   – phone if shown. "" if absent.

─── HOMEOWNERS COVERAGES ────────────────────────────────────────
• dwelling, other_structures, personal_property, loss_of_use,
  personal_liability, medical_payments – dollar amounts with $.
• replacement_cost_on_contents – "Yes", "No", or "".
• 25_extended_replacement_cost – "Yes", "No", or "".
• all_perils_deductible, wind_hail_deductible – may combine % and $,
  e.g. "2% - $3,076".
• water_and_sewer_backup – dollar amount or "".

─── AUTO POLICY DETAILS ─────────────────────────────────────────
• auto_policy_term – "6-Month", "12-Month", or "Unknown".

─── AUTO DRIVERS (array) ────────────────────────────────────────
• driver_name, gender ("Male"/"Female"/"Unknown"), marital_status, license_state.

─── AUTO VEHICLES (array) ───────────────────────────────────────
• year_make_model_trim, vin, vehicle_use, garaging_zip_county.
• coverage_premiums – per-vehicle premium amounts.
• subtotal – total premium for this vehicle.

─── AUTO COVERAGES (policy-level limits & deductibles) ──────────
• bi_limit, pd_limit, medpay_limit, um_uim_bi_limit, umpd_limit,
  umpd_deductible, comprehensive_deductible, collision_deductible,
  rental_limit, towing_limit.

─── AUTO PAYMENT OPTIONS ────────────────────────────────────────
For full_pay:
  full_pay_amount        – total amount due if paying in full.
  eft_reduces_fee        – "Yes"/"No" or "" if not stated.
For each installment plan (semi_annual, quarterly, monthly):
  down_payment           – the required down payment for that plan.
  amount_per_installment – amount due per installment after the down payment.
  number_of_installments – count of installments after the down payment
                           (digits only, e.g. "5", "11").
  eft_reduces_fee        – "Yes"/"No" or the reduced amount if EFT reduces
                           installment fees on this plan.
paid_in_full_discount: gross_premium, discount_amount, net_pay_in_full.

─── CONFIDENCE SCORING ──────────────────────────────────────────
For every flat field and coverage field, provide a confidence score
(0.0 to 1.0) in the "confidence" object.

─── RULES ───────────────────────────────────────────────────────
• Return ONLY the JSON object. No commentary.
• If a field cannot be found, return "" for strings, [] for arrays.
• Preserve money formatting with a leading $.
• Split limits use " / " separator: "$X / $Y".
• Do NOT invent data.
• For names, format as "First Last", never "Last, First".
"""


QUICK_PASS_PROMPT = """\
You are a fast insurance data extractor for a BUNDLE (homeowners + auto) quote.
Extract fields from this PDF as quickly as possible.

Output ONLY lines in this exact format (one per line):
field_key: value

Use these keys for bundle policy and homeowners:
  bundle_total_premium, home_premium, auto_premium,
  quote_date, quote_effective_date, quote_expiration_date,
  client_name, client_address, client_email, client_phone,
  dwelling, other_structures, personal_property, loss_of_use,
  personal_liability, medical_payments, replacement_cost_on_contents,
  25_extended_replacement_cost, all_perils_deductible,
  wind_hail_deductible, water_and_sewer_backup

Use this key for auto details:
  auto_policy_term

For auto coverage limits/deductibles:
  bi_limit, pd_limit, medpay_limit, um_uim_bi_limit, umpd_limit,
  umpd_deductible, comprehensive_deductible, collision_deductible,
  rental_limit, towing_limit

For drivers, use numbered keys:
  driver_1_name, driver_1_gender, driver_1_marital_status, driver_1_license_state
  driver_2_name, ...

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
- auto_policy_term must be "6-Month", "12-Month", or "Unknown".
- replacement_cost_on_contents and 25_extended_replacement_cost must be "Yes" or "No" if known.
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


def normalize_bundle_result(parsed: dict) -> tuple:
    """Ensure every expected key exists. Returns (data_dict, flat_confidence_dict)."""
    raw_confidence = parsed.pop("confidence", {})

    # Flat keys
    for k in ALL_FLAT_KEYS:
        parsed.setdefault(k, "")
        if parsed[k] is None:
            parsed[k] = ""

    # Yes/No normalization
    for k in YES_NO_FIELDS:
        val = str(parsed.get(k, "")).strip()
        if val.lower() == "yes":
            parsed[k] = "Yes"
        elif val.lower() == "no":
            parsed[k] = "No"
        elif val:
            parsed[k] = val

    # Auto policy term normalization
    if parsed.get("auto_policy_term") == "Unknown":
        parsed["auto_policy_term"] = ""

    # Drivers
    drivers = parsed.get("drivers") or []
    for d in drivers:
        for dk in ("driver_name", "gender", "marital_status", "license_state"):
            d.setdefault(dk, "")
        if d.get("gender") == "Unknown":
            d["gender"] = ""
    parsed["drivers"] = drivers

    # Vehicles
    vehicles = parsed.get("vehicles") or []
    for v in vehicles:
        for vk in ("year_make_model_trim", "vin", "vehicle_use", "garaging_zip_county", "subtotal"):
            v.setdefault(vk, "")
        cp = v.get("coverage_premiums") or {}
        v["coverage_premiums"] = {k: cp.get(k, "") for k in VEHICLE_PREMIUM_KEYS}
    parsed["vehicles"] = vehicles

    # Coverages
    cov = parsed.get("coverages") or {}
    parsed["coverages"] = {k: cov.get(k, "") for k in AUTO_COVERAGE_KEYS}

    # Payment options
    po = parsed.get("payment_options") or {}
    for plan in PLAN_NAMES:
        p = po.get(plan) or {}
        po[plan] = {k: p.get(k, "") for k in _plan_keys(plan)}
    pif = po.get("paid_in_full_discount") or {}
    po["paid_in_full_discount"] = {k: pif.get(k, "") for k in PIF_DISCOUNT_KEYS}
    has_pif = any(po["paid_in_full_discount"][k] for k in PIF_DISCOUNT_KEYS)
    po["show_paid_in_full_discount"] = has_pif
    parsed["payment_options"] = po

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

    # Flat fields (bundle policy + homeowners + auto policy details)
    for k in ALL_FLAT_KEYS:
        if k in raw:
            val = raw[k]
            if k in YES_NO_FIELDS:
                if val.lower() == "yes":
                    val = "Yes"
                elif val.lower() == "no":
                    val = "No"
                else:
                    continue
            result[k] = val

    # Auto coverages
    coverages = {}
    for k in AUTO_COVERAGE_KEYS:
        if k in raw:
            coverages[k] = raw[k]
    if coverages:
        result["coverages"] = coverages

    # Drivers (numbered: driver_1_name, driver_2_gender, etc.)
    driver_map = {}
    driver_fields = {
        "name": "driver_name", "gender": "gender",
        "marital_status": "marital_status", "license_state": "license_state",
    }
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
        "vin": "vin", "vehicle_use": "vehicle_use",
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

    # Payment options
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

def stream_bundle_quote_with_gemini(
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

        yield json.dumps({"type": "status", "message": "Reading bundle quote..."}) + "\n"

        # ── PASS 1: quick draft extraction (key:value lines) ─────
        quick_text = ""
        quick_user_prompt = "Quickly extract likely fields from this bundle (homeowners + auto) insurance quote PDF."
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

        # ── Draft "Why Selected" after pass 1 ──
        draft_data = json.loads(sent_draft_json) if sent_draft_json else {}
        from why_selected_generator import generate_why_selected_draft, generate_why_selected_refine
        draft_bullets = generate_why_selected_draft(draft_data, "bundle")
        if draft_bullets:
            yield json.dumps({"type": "draft_patch", "data": {"why_selected": draft_bullets}}) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted bundle fields..."}) + "\n"

        # ── PASS 2: strict structured extraction ─────────────────
        full_text = ""
        sent_final_json = ""

        final_user_prompt = "Extract the bundle (homeowners + auto) insurance quote fields from this PDF."
        final_stream = stream_with_fallback(
            client,
            model_final,
            model_final_fallback,
            contents=[final_user_prompt, uploaded_file],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=BUNDLE_SCHEMA,
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
                json_schema=BUNDLE_SCHEMA,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue

            full_text += text
            partial = extract_partial_json_root(full_text)

            if partial:
                partial.pop("confidence", None)
                partial_json = json.dumps(partial, sort_keys=True)
                if partial_json != sent_final_json:
                    sent_final_json = partial_json
                    yield json.dumps({
                        "type": "final_patch",
                        "data": partial,
                    }) + "\n"

        parsed = json.loads(full_text)
        data, confidence = normalize_bundle_result(parsed)

        # Refine "Why This Plan Was Selected" bullets using final data
        yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
        data["why_selected"] = generate_why_selected_refine(data, draft_bullets, "bundle")

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


def classify_pdf(client, uploaded_file) -> str:
    """Ask Gemini to classify a PDF as 'homeowners' or 'auto'."""
    resp = generate_with_fallback(
        client,
        "gemini-2.5-flash-lite",
        DEFAULT_QUICK_FALLBACKS,
        contents=[
            "What type of insurance quote is this PDF? Reply with ONLY one word: 'homeowners' or 'auto'.",
            uploaded_file,
        ],
        config=types.GenerateContentConfig(temperature=0),
    )
    text = (resp.text or "").strip().lower()
    if "home" in text:
        return "homeowners"
    return "auto"


def stream_two_file_bundle(home_path: Path, auto_path: Path) -> Iterator[str]:
    """Parse 2 separate PDFs (homeowners + auto) and merge into bundle schema."""
    from parsers.homeowners_parser_api import stream_homeowners_quote_with_gemini
    from parsers.auto_parser_api import stream_auto_quote_with_gemini

    yield json.dumps({"type": "status", "message": "Parsing homeowners quote..."}) + "\n"

    # Collect homeowners result
    home_data = None
    home_confidence = {}
    for line in stream_homeowners_quote_with_gemini(home_path):
        msg = json.loads(line.strip()) if line.strip() else None
        if not msg:
            continue
        if msg.get("type") == "status":
            yield json.dumps({"type": "status", "message": f"[Home] {msg.get('message', '')}"}) + "\n"
        elif msg.get("type") == "draft_patch" and msg.get("data"):
            yield json.dumps({"type": "draft_patch", "data": msg["data"]}) + "\n"
        elif msg.get("type") == "final_patch" and msg.get("data"):
            yield json.dumps({"type": "final_patch", "data": msg["data"]}) + "\n"
        elif msg.get("type") == "result":
            home_data = msg.get("data", {})
            home_confidence = msg.get("confidence", {})
        elif msg.get("type") == "error":
            yield line
            return

    yield json.dumps({"type": "status", "message": "Parsing auto quote..."}) + "\n"

    # Collect auto result
    auto_data = None
    auto_confidence = {}
    for line in stream_auto_quote_with_gemini(auto_path):
        msg = json.loads(line.strip()) if line.strip() else None
        if not msg:
            continue
        if msg.get("type") == "status":
            yield json.dumps({"type": "status", "message": f"[Auto] {msg.get('message', '')}"}) + "\n"
        elif msg.get("type") == "draft_patch" and msg.get("data"):
            # Remap auto flat fields to bundle prefixed keys
            remapped = _remap_auto_to_bundle(msg["data"])
            yield json.dumps({"type": "draft_patch", "data": remapped}) + "\n"
        elif msg.get("type") == "final_patch" and msg.get("data"):
            remapped = _remap_auto_to_bundle(msg["data"])
            yield json.dumps({"type": "final_patch", "data": remapped}) + "\n"
        elif msg.get("type") == "result":
            auto_data = msg.get("data", {})
            auto_confidence = msg.get("confidence", {})
        elif msg.get("type") == "error":
            yield line
            return

    if not home_data or not auto_data:
        yield json.dumps({"type": "error", "error": "Failed to parse one or both PDFs."}) + "\n"
        return

    # Merge into bundle format
    merged = _merge_home_auto_to_bundle(home_data, auto_data)
    merged_confidence = {**home_confidence, **auto_confidence}

    # Generate "Why This Plan Was Selected" bullets (2-pass: draft then refine on merged data)
    yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
    from why_selected_generator import generate_why_selected_draft, generate_why_selected_refine
    draft_bullets = generate_why_selected_draft(merged, "bundle")
    if draft_bullets:
        yield json.dumps({"type": "draft_patch", "data": {"why_selected": draft_bullets}}) + "\n"
    merged["why_selected"] = generate_why_selected_refine(merged, draft_bullets, "bundle")

    yield json.dumps({"type": "result", "data": merged, "confidence": merged_confidence}) + "\n"


def _sum_premiums(*amounts: str) -> str:
    """Parse dollar-formatted strings and return their sum as a formatted dollar string.

    Handles formats like "$2,641.00", "1528.15", "$1,234", etc.
    Returns "" if no valid amounts could be parsed.
    """
    import re
    total = 0.0
    found_any = False
    for raw in amounts:
        if not raw or not str(raw).strip():
            continue
        cleaned = re.sub(r"[,$\s]", "", str(raw).strip())
        try:
            total += float(cleaned)
            found_any = True
        except (ValueError, TypeError):
            continue
    if not found_any:
        return ""
    # Format as $X,XXX.XX
    return f"${total:,.2f}"


def _remap_auto_to_bundle(data: dict) -> dict:
    """Remap auto parser flat fields to bundle auto_ prefixed keys."""
    remapped = {}
    auto_remap = {
        "policy_term": "auto_policy_term",
    }
    for k, v in data.items():
        if k in auto_remap:
            remapped[auto_remap[k]] = v
        elif k in ("drivers", "vehicles", "coverages", "payment_options"):
            remapped[k] = v
        elif k in ("total_premium",):
            remapped["auto_premium"] = v
        elif k in ("paid_in_full_discount",) and isinstance(v, str):
            remapped["auto_paid_in_full_discount"] = v
        elif k in ("total_pay_in_full",) and isinstance(v, str):
            remapped["auto_total_pay_in_full"] = v
        elif k == "premium_summary" and isinstance(v, dict):
            if v.get("total_premium"):
                remapped["auto_premium"] = v["total_premium"]
            if v.get("paid_in_full_discount"):
                remapped["auto_paid_in_full_discount"] = v["paid_in_full_discount"]
            if v.get("total_pay_in_full"):
                remapped["auto_total_pay_in_full"] = v["total_pay_in_full"]
        elif k not in ("client_name", "client_address", "client_phone", "client_email",
                        "agent_name", "agent_address", "agent_phone", "agent_email"):
            remapped[k] = v
    return remapped


def _merge_home_auto_to_bundle(home: dict, auto: dict) -> dict:
    """Merge separate homeowners and auto results into one bundle form."""
    merged = {}

    # Client info from homeowners (primary) with auto fallback
    for k in ("client_name", "client_address", "client_email", "client_phone"):
        merged[k] = home.get(k, "") or auto.get(k, "")

    # Homeowners coverages
    home_cov_keys = [
        "dwelling", "other_structures", "personal_property", "loss_of_use",
        "personal_liability", "medical_payments", "replacement_cost_on_contents",
        "25_extended_replacement_cost", "all_perils_deductible",
        "wind_hail_deductible", "water_and_sewer_backup",
    ]
    for k in home_cov_keys:
        merged[k] = home.get(k, "")

    # Home premium
    merged["home_premium"] = home.get("total_premium", "")

    # Auto fields (remapped to bundle prefixed)
    auto_remap = {
        "policy_term": "auto_policy_term",
    }
    for src, dst in auto_remap.items():
        merged[dst] = auto.get(src, "")

    # Auto premium from premium_summary or top-level
    ps = auto.get("premium_summary", {})
    merged["auto_premium"] = ps.get("total_premium", "") or auto.get("total_premium", "")
    merged["auto_paid_in_full_discount"] = ps.get("paid_in_full_discount", "") or auto.get("paid_in_full_discount", "")
    merged["auto_total_pay_in_full"] = ps.get("total_pay_in_full", "") or auto.get("total_pay_in_full", "")

    # Bundle total = auto-compute by summing home + auto premiums
    merged["bundle_total_premium"] = _sum_premiums(merged.get("home_premium", ""), merged.get("auto_premium", ""))

    # Auto arrays and objects
    merged["drivers"] = auto.get("drivers", [])
    merged["vehicles"] = auto.get("vehicles", [])
    merged["coverages"] = auto.get("coverages", {})
    merged["payment_options"] = auto.get("payment_options", {})

    return merged


@router.post("/api/parse-bundle-quote")
async def parse_bundle_quote(files: List[UploadFile] = File(...)):
    # Validate all files are PDFs
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Please upload PDF files only.")

    if len(files) > 2:
        raise HTTPException(status_code=400, detail="Bundle accepts at most 2 PDFs.")

    # Read all file bytes upfront and store in database
    file_bytes_list = []
    for f in files:
        f_bytes = await f.read()
        file_bytes_list.append(f_bytes)
        try:
            await store_uploaded_pdf(
                file_data=f_bytes,
                file_name=f.filename or "bundle_quote.pdf",
                insurance_type="bundle",
            )
        except Exception:
            pass

    if len(files) == 1:
        # Single combined bundle PDF — use bundle parser
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(file_bytes_list[0])

        def event_stream_single():
            try:
                yield from stream_bundle_quote_with_gemini(temp_path)
            finally:
                if temp_path.exists():
                    temp_path.unlink(missing_ok=True)

        return StreamingResponse(
            event_stream_single(),
            media_type="application/x-ndjson",
        )

    # Two files — classify and parse separately, then merge
    temp_paths = []
    for fb in file_bytes_list:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tf:
            tf.write(fb)
            temp_paths.append(Path(tf.name))

    def event_stream_dual():
        try:
            client = get_gemini_client()

            # Upload both for classification
            uploaded_a = upload_with_retry(client, file=str(temp_paths[0]), config={"mime_type": "application/pdf"})
            uploaded_b = upload_with_retry(client, file=str(temp_paths[1]), config={"mime_type": "application/pdf"})

            yield json.dumps({"type": "status", "message": "Identifying PDF types..."}) + "\n"

            type_a = classify_pdf(client, uploaded_a)
            type_b = classify_pdf(client, uploaded_b)

            # Clean up classification uploads
            try:
                client.files.delete(name=uploaded_a.name)
                client.files.delete(name=uploaded_b.name)
            except Exception:
                pass

            # Determine which is homeowners and which is auto
            if type_a == "homeowners" and type_b == "auto":
                home_path, auto_path = temp_paths[0], temp_paths[1]
            elif type_a == "auto" and type_b == "homeowners":
                home_path, auto_path = temp_paths[1], temp_paths[0]
            elif type_a == "homeowners":
                # Both classified as homeowners — assume second is auto
                home_path, auto_path = temp_paths[0], temp_paths[1]
            else:
                # Both classified as auto — assume first is homeowners
                home_path, auto_path = temp_paths[0], temp_paths[1]

            yield from stream_two_file_bundle(home_path, auto_path)

        except Exception as exc:
            yield json.dumps({"type": "error", "error": str(exc)}) + "\n"
        finally:
            for p in temp_paths:
                if p.exists():
                    p.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream_dual(),
        media_type="application/x-ndjson",
    )
