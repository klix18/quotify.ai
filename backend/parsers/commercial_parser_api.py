# commercial_parser_api.py
# Uses Gemini Flash 2.5
# 2-pass extraction for commercial insurance quotes:
#   Pass 1 = fast draft with gemini-2.5-flash-lite  (key:value streaming)
#   Pass 2 = strict structured JSON with gemini-2.5-flash
# Field mapping matches frontend commercialConfig.js exactly.

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
POLICY_KEYS = [
    "named_insured",
    "mailing_address",
    "client_email",
    "client_phone",
    "policy_term",
    "total_premium",
    "quote_date",
    "quote_effective_date",
    "quote_expiration_date",
    "additional_premiums_taxes_fees",
]

AGENT_KEYS = [
    "agent_name",
    "agent_address",
    "agent_phone",
    "agent_email",
]

# Commercial Property (no carrier fields)
CP_KEYS = [
    "building_limit",
    "building_deductible",
    "bpp_limit",
    "bpp_deductible",
    "stretch_blanket",
    "business_income",
    "business_income_waiting_period",
    "equipment_breakdown",
    "back_up_sewers_drains",
    "ordinance_or_law",
    "wind_hail_deductible",
]

# General Liability (no carrier fields, no liability_and_medical_expenses)
GL_KEYS = [
    "gl_each_occurrence",
    "gl_general_aggregate",
    "gl_products_completed_ops_aggregate",
    "gl_medical_expenses",
    "gl_damage_to_premises_rented",
    "gl_personal_advertising_injury",
]

# Workers' Compensation — flat coverage limits only
# Class codes are handled as a separate repeatable array
WC_FLAT_KEYS = [
    "wc_bi_accident_each_accident",
    "wc_bi_disease_policy_limit",
    "wc_bi_disease_each_employee",
]

# Each class code sub-item
WC_CLASS_CODE_KEYS = ["class_code", "estimated_annual_remuneration", "rating", "premium"]

# Excess / Umbrella Liability (no carrier, no self_insured_retention)
EXCESS_KEYS = [
    "umbrella_each_occurrence",
    "umbrella_aggregate",
]

# Cyber Liability (no carrier fields)
CYBER_KEYS = [
    "cyber_aggregate_limit",
    "cyber_deductible",
    "cyber_breach_response",
    "cyber_business_interruption",
    "cyber_cyber_extortion",
    "cyber_funds_transfer_fraud",
    "cyber_regulatory_defense",
    "cyber_media_tech_liability",
]

# Wind Insurance
WIND_COVERAGE_KEYS = [
    "wind_coverage",
    "wind_deductible",
    "wind_percent_deductible",
    "wind_coverage_premium",
]

WIND_BUYDOWN_KEYS = [
    "wind_buydown",
    "wind_buydown_amount",
    "wind_buydown_premium",
]

WIND_KEYS = WIND_COVERAGE_KEYS + WIND_BUYDOWN_KEYS

ALL_FLAT_KEYS = (
    POLICY_KEYS + AGENT_KEYS + CP_KEYS + GL_KEYS +
    WC_FLAT_KEYS + EXCESS_KEYS + CYBER_KEYS + WIND_KEYS
)


# ── Gemini structured-output schema (Pass 2) ────────────────────
# NOTE: We nest coverage sections as sub-objects to keep the schema
# small enough for Gemini's structured output constraint limit.
# The normalize step flattens these back to the flat form the frontend expects.

def _section_obj(keys):
    """Build a schema sub-object from a list of string keys."""
    return {
        "type": "object",
        "properties": {k: {"type": "string"} for k in keys},
        "required": keys,
    }

# Workers' comp section: flat coverage keys + wc_class_codes array
_wc_section_props = {k: {"type": "string"} for k in WC_FLAT_KEYS}
_wc_section_props["wc_class_codes"] = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {k: {"type": "string"} for k in WC_CLASS_CODE_KEYS},
        "required": WC_CLASS_CODE_KEYS,
    },
}
WC_SECTION_SCHEMA = {
    "type": "object",
    "properties": _wc_section_props,
    "required": WC_FLAT_KEYS + ["wc_class_codes"],
}

# Top-level keys kept flat (small set)
_TOP_FLAT_KEYS = POLICY_KEYS + AGENT_KEYS

# Section groupings used in schema (nested as sub-objects)
SECTION_MAP = {
    "commercial_property": CP_KEYS,
    "general_liability": GL_KEYS,
    "excess_liability": EXCESS_KEYS,
    "cyber": CYBER_KEYS,
    "wind_insurance": WIND_KEYS,
}

COMMERCIAL_SCHEMA = {
    "type": "object",
    "properties": {
        # Flat top-level fields (policy + agent)
        **{k: {"type": "string"} for k in _TOP_FLAT_KEYS},

        # Nested coverage sections
        **{section: _section_obj(keys) for section, keys in SECTION_MAP.items()},

        # Workers' comp has special structure (flat limits + class codes array)
        "workers_comp": WC_SECTION_SCHEMA,
    },
    "required": _TOP_FLAT_KEYS + list(SECTION_MAP.keys()) + ["workers_comp"],
}


# ── Prompts ──────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert commercial-insurance data extractor. You receive a scanned or
digital commercial insurance quote / proposal / submission PDF and return a single
JSON object that maps exactly to the schema provided.

CRITICAL: You MUST read EVERY page of the PDF. Commercial proposals often have
coverage details spread across many pages with separate sections for each line
of business. Do NOT skip any page or section.

ABSOLUTE RULE: NEVER fabricate, guess, or hallucinate values. If a field is not
explicitly printed in the document, return "" (empty string). It is far better to
return "" than to return an incorrect value. Wrong data is worse than missing data.

─── FIELD GUIDANCE ───────────────────────────────────────────────

POLICY & CLIENT INFORMATION
• named_insured   – the insured / applicant / named insured / client, NOT the agency or broker.
• mailing_address – the client's mailing address.
• client_email    – the client's email address if present.
• client_phone    – the client's phone number if present.
• policy_term     – the overall policy term period, e.g. "06/20/2025 - 06/20/2026".
• total_premium   – the total annual premium across ALL lines of business combined.
    ALIASES: "Total Premium", "Total Annual Premium", "Grand Total"
• quote_date            – the date the quote / proposal was generated or printed.
                          Use MM/DD/YYYY format.
    ALIASES: "Quote Date", "Proposal Date", "Print Date", "Prepared On"
• quote_effective_date  – the date coverage / the policy becomes effective.
                          Use MM/DD/YYYY format.
    ALIASES: "Effective Date", "Inception Date", "Policy Effective Date"
• quote_expiration_date – the date the quote expires (or the policy expiration
                          date if a quote-specific expiration is not shown).
                          Use MM/DD/YYYY format.
    ALIASES: "Expiration Date", "Quote Expires", "Policy Expiration Date"
• additional_premiums_taxes_fees – additional premiums, taxes, and fees total.
    ALIASES: "Additional Premiums, Taxes, Fees", "Taxes & Fees"

AGENT / BROKER INFORMATION
• agent_name    – the agent, advisor, producer, or broker name. NOT the brokerage company name.
• agent_address – the agent's office address.
• agent_phone   – the agent's phone number.
• agent_email   – the agent's email address.

COMMERCIAL PROPERTY
• building_limit – Building coverage limit.
    ALIASES: "Building", "Building Limit"
• building_deductible – Building deductible.
• bpp_limit     – Business Personal Property limit.
    ALIASES: "Business Personal Property", "BPP", "Contents"
• bpp_deductible – BPP deductible.
• stretch_blanket – Stretch Blanket or Blanket limit.
    ALIASES: "Stretch Blanket", "Blanket"
• business_income – Business Income coverage limit or period.
    ALIASES: "Business Income", "Business Income Coverage"
• business_income_waiting_period – Waiting period for business income (e.g., "24 hours").
• equipment_breakdown – Equipment Breakdown limit.
    ALIASES: "Equipment Breakdown", "Boiler & Machinery"
• back_up_sewers_drains – Back-up of Sewers & Drains coverage limit.
    ALIASES: "Back-up of Sewers and Drains", "Sewer Backup", "Water Backup"
• ordinance_or_law – Ordinance or Law coverage limit.
    ALIASES: "Ordinance or Law", "Ordinance or Law Coverage"
• wind_hail_deductible – Wind/Hail deductible if separate.

GENERAL LIABILITY
• gl_each_occurrence – General Liability Each Occurrence limit.
    ALIASES: "Each Occurrence", "Per Occurrence"
• gl_general_aggregate – General Liability General Aggregate limit.
    ALIASES: "General Aggregate"
• gl_products_completed_ops_aggregate – Products/Completed Operations Aggregate.
    ALIASES: "Products/Completed Operations Aggregate", "Products-Completed Operations Aggregate"
• gl_medical_expenses – Medical Expenses limit.
    ALIASES: "Medical Expenses", "Medical Expense"
• gl_damage_to_premises_rented – Damage to Premises Rented to You limit.
    ALIASES: "Damage to Premises Rented to You", "Fire Damage", "Damage to Rented Premises"
• gl_personal_advertising_injury – Personal and Advertising Injury limit.
    ALIASES: "Personal and Advertising Injury", "Personal & Advertising Injury"

WORKERS' COMPENSATION
Coverage limits:
• wc_bi_accident_each_accident – Bodily Injury by Accident – Each Accident limit.
    ALIASES: "Bodily Injury by Accident Each Accident", "BI by Accident"
• wc_bi_disease_policy_limit – Bodily Injury by Disease – Policy Limit.
    ALIASES: "Bodily Injury by Disease Policy Limit", "BI by Disease Policy Limit"
• wc_bi_disease_each_employee – Bodily Injury by Disease – Each Employee.
    ALIASES: "Bodily Injury by Disease Each Employee", "BI by Disease Each Employee"

Class codes (repeatable array — extract ALL class codes found):
Each item in the wc_class_codes array:
• class_code – Classification class code (e.g., "8859").
    ALIASES: "Class Code", "Classification Code"
• estimated_annual_remuneration – Estimated annual remuneration / payroll.
    ALIASES: "Estimated Annual Remuneration", "Annual Remuneration", "Estimated Payroll"
• rating – The rate or modifier for this class code.
    ALIASES: "Rate", "Rating", "Modifier"
• premium – Premium for this class code.
    ALIASES: "Premium", "Estimated Premium"

EXCESS / UMBRELLA LIABILITY
• umbrella_each_occurrence – Umbrella Each Occurrence limit.
    ALIASES: "Umbrella Each Occurrence", "Each Occurrence"
• umbrella_aggregate – Umbrella Aggregate limit.
    ALIASES: "Umbrella Aggregate", "Aggregate"

CYBER LIABILITY
• cyber_aggregate_limit – Policy Aggregate Limit of Liability.
    ALIASES: "Policy Aggregate Limit", "Aggregate Limit of Liability"
• cyber_deductible – General deductible for cyber coverage.
• cyber_breach_response – Breach Response Costs limit.
    ALIASES: "Breach Response Costs", "Breach Response"
• cyber_business_interruption – Business Interruption limit (combined security + system).
    ALIASES: "Business Interruption", "Business Interruption Loss"
• cyber_cyber_extortion – Cyber Extortion Loss limit.
    ALIASES: "Cyber Extortion", "Cyber Extortion Loss"
• cyber_funds_transfer_fraud – Funds Transfer Fraud limit.
    ALIASES: "Funds Transfer Fraud"
• cyber_regulatory_defense – Regulatory Defense & Penalties limit.
    ALIASES: "Regulatory Defense & Penalties", "Regulatory Defense"
• cyber_media_tech_liability – Media, Tech, Data & Network Liability limit.
    ALIASES: "Media, Tech, Data & Network Liability", "Tech & Professional Services"

WIND INSURANCE
Wind Coverage (only populate if wind coverage is present in the document):
• wind_coverage – Wind coverage limit or description.
    ALIASES: "Wind", "Wind Coverage", "Named Storm"
• wind_deductible – Wind deductible (dollar amount).
    ALIASES: "Wind Deductible", "Named Storm Deductible"
• wind_percent_deductible – Wind percentage deductible (e.g., "2%", "5%").
    ALIASES: "Wind % Deductible", "Wind Percentage Deductible"
• wind_coverage_premium – Premium for wind coverage.
    ALIASES: "Wind Premium", "Named Storm Premium"

Wind Buydown (only populate if wind buydown is present in the document):
• wind_buydown – Wind buydown description or limit.
    ALIASES: "Wind Buydown", "Wind Deductible Buydown"
• wind_buydown_amount – Buydown amount.
    ALIASES: "Buydown Amount"
• wind_buydown_premium – Premium for wind buydown.
    ALIASES: "Wind Buydown Premium", "Buydown Premium"

─── RULES ────────────────────────────────────────────────────────
• Return ONLY the JSON object. No commentary.
• If a field cannot be found, return "" for strings, [] for arrays.
• Preserve money formatting with a leading $. Examples: "$1,250.00", "$500".
• NEVER invent or guess data. If the document does not contain a value, use "".
  Returning a wrong value is MUCH worse than returning "".
• Read EVERY page of the document. Do NOT stop after the first page.
• Not all commercial proposals contain all lines of business. Only extract
  sections that are actually present. Leave fields "" for absent lines.
"""


QUICK_PASS_PROMPT = """\
You are an accurate commercial-insurance data extractor.
Extract fields from this commercial insurance quote/proposal PDF.

CRITICAL: Read EVERY page of the PDF before extracting. Commercial proposals
typically have separate sections for each line of business (Commercial Property,
General Liability, Workers' Compensation, Excess/Umbrella, Cyber, etc.).
You MUST check ALL sections.

NEVER guess or fabricate. Only output a field if you can see the value printed in
the document. Omit any field you cannot find — omitting is always better than guessing wrong.

Output ONLY lines in this exact format (one per line):
field_key: value

Use these keys for policy & client info:
  named_insured, mailing_address, client_email, client_phone,
  policy_term, total_premium, quote_date, quote_effective_date,
  quote_expiration_date, additional_premiums_taxes_fees

For agent/broker info:
  agent_name, agent_address, agent_phone, agent_email

For commercial property:
  building_limit, building_deductible, bpp_limit, bpp_deductible,
  stretch_blanket, business_income, business_income_waiting_period,
  equipment_breakdown, back_up_sewers_drains, ordinance_or_law, wind_hail_deductible

For general liability:
  gl_each_occurrence, gl_general_aggregate, gl_products_completed_ops_aggregate,
  gl_medical_expenses, gl_damage_to_premises_rented, gl_personal_advertising_injury

For workers' compensation coverage limits:
  wc_bi_accident_each_accident, wc_bi_disease_policy_limit, wc_bi_disease_each_employee

For workers' compensation class codes (numbered):
  wc_class_code_1_class_code, wc_class_code_1_estimated_annual_remuneration, wc_class_code_1_rating, wc_class_code_1_premium
  wc_class_code_2_class_code, wc_class_code_2_estimated_annual_remuneration, wc_class_code_2_rating, wc_class_code_2_premium
  (etc.)

For excess/umbrella:
  umbrella_each_occurrence, umbrella_aggregate

For cyber:
  cyber_aggregate_limit, cyber_deductible, cyber_breach_response,
  cyber_business_interruption, cyber_cyber_extortion,
  cyber_funds_transfer_fraud, cyber_regulatory_defense, cyber_media_tech_liability

For wind insurance (only if wind coverage is present in document):
  wind_coverage, wind_deductible, wind_percent_deductible, wind_coverage_premium,
  wind_buydown, wind_buydown_amount, wind_buydown_premium

Field aliases to look for:
- building_limit: "Building", "Building Limit"
- bpp_limit: "Business Personal Property", "BPP", "Contents"
- gl_each_occurrence: "Each Occurrence", "Per Occurrence"
- gl_general_aggregate: "General Aggregate"
- umbrella_each_occurrence: "Umbrella Each Occurrence"
- cyber_aggregate_limit: "Policy Aggregate Limit"

Rules:
- ONLY output values you can see in the document. NEVER guess.
- Skip fields you cannot find — do NOT make up values.
- Do not explain anything, just output key: value lines.
- Monetary values must have $ prefix: "$1,000,000", "$2,500"
- Not all lines of business may be present — only extract what exists in the document.
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


def normalize_commercial_result(parsed: dict) -> tuple:
    """Flatten nested schema structure back to the flat form the frontend expects.
    Returns (flat_data_dict, flat_confidence_dict)."""
    raw_confidence = parsed.pop("confidence", {})

    flat = {}

    # Copy top-level flat keys
    for k in _TOP_FLAT_KEYS:
        flat[k] = parsed.get(k, "") or ""

    # Flatten nested coverage sections back to top-level
    for section, keys in SECTION_MAP.items():
        section_data = parsed.get(section) or {}
        section_conf = raw_confidence.get(section) or {}
        for k in keys:
            flat[k] = section_data.get(k, "") or ""
            # Hoist confidence values to top-level
            if k in section_conf:
                raw_confidence[k] = section_conf[k]

    # Workers' comp (special handling: flat keys + class codes array)
    wc_data = parsed.get("workers_comp") or {}
    wc_conf = raw_confidence.get("workers_comp") or {}
    for k in WC_FLAT_KEYS:
        flat[k] = wc_data.get(k, "") or ""
        if k in wc_conf:
            raw_confidence[k] = wc_conf[k]

    # WC class codes
    wc_class_codes = wc_data.get("wc_class_codes") or []
    for cc in wc_class_codes:
        for k in WC_CLASS_CODE_KEYS:
            cc.setdefault(k, "")
            if cc[k] is None:
                cc[k] = ""
    flat["wc_class_codes"] = wc_class_codes

    # Ensure all flat keys exist
    for k in ALL_FLAT_KEYS:
        flat.setdefault(k, "")

    # Flatten confidence (remove section wrappers, keep flat keys)
    for section in list(SECTION_MAP.keys()) + ["workers_comp"]:
        raw_confidence.pop(section, None)
    flat_confidence = flatten_confidence(raw_confidence)

    return flat, flat_confidence


def extract_quick_pass_lines(text: str) -> dict:
    """Parse key:value lines from Pass 1 into a form-shaped dict."""
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

    # All flat fields
    for k in ALL_FLAT_KEYS:
        if k in raw:
            result[k] = raw[k]

    # WC class codes (numbered: wc_class_code_1_class_code, etc.)
    cc_map = {}
    for rk, rv in raw.items():
        m = re.match(r"wc_class_code_(\d+)_(\w+)", rk)
        if m:
            idx = int(m.group(1)) - 1
            field = m.group(2)
            if field in WC_CLASS_CODE_KEYS:
                cc_map.setdefault(idx, {})
                cc_map[idx][field] = rv
    if cc_map:
        max_idx = max(cc_map.keys())
        codes = []
        for i in range(max_idx + 1):
            cc = cc_map.get(i, {})
            codes.append({k: cc.get(k, "") for k in WC_CLASS_CODE_KEYS})
        result["wc_class_codes"] = codes

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

def stream_commercial_quote_with_gemini(
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

        yield json.dumps({"type": "status", "message": "Reading commercial quote..."}) + "\n"

        # ── PASS 1: quick draft extraction (key:value lines) ─────
        quick_text = ""
        quick_user_prompt = (
            "Read ALL pages of this commercial insurance quote/proposal PDF carefully. "
            "Extract every field you can find. This is a commercial lines proposal that may "
            "contain sections for Commercial Property, General Liability, Workers' Compensation, "
            "Excess/Umbrella Liability, and Cyber Liability. "
            "Check each section thoroughly. Only output values you can actually see in the document."
        )
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
        draft_bullets = generate_why_selected_draft(draft_data, "commercial")
        if draft_bullets:
            yield json.dumps({"type": "draft_patch", "data": {"why_selected": draft_bullets}}) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted commercial fields..."}) + "\n"

        # ── PASS 2: strict structured extraction ─────────────────
        full_text = ""
        sent_final_json = ""

        final_user_prompt = (
            "Read ALL pages of this commercial insurance quote/proposal PDF thoroughly. "
            "Extract every field into the JSON schema. "
            "IMPORTANT: Check each section of the proposal — Commercial Property, "
            "General Liability, Workers' Compensation, Excess/Umbrella, and Cyber. "
            "For each line of business, extract the key coverage limits. "
            "For Workers' Comp, extract ALL class codes found into the wc_class_codes array. "
            "NEVER guess — only extract values explicitly shown in the document."
        )
        final_stream = stream_with_fallback(
            client,
            model_final,
            model_final_fallback,
            contents=[final_user_prompt, uploaded_file],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=COMMERCIAL_SCHEMA,
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
                json_schema=COMMERCIAL_SCHEMA,
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
        data, confidence = normalize_commercial_result(parsed)

        # Refine "Why This Plan Was Selected" bullets using final data
        yield json.dumps({"type": "status", "message": "Generating plan summary..."}) + "\n"
        data["why_selected"] = generate_why_selected_refine(data, draft_bullets, "commercial")

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


@router.post("/api/parse-commercial-quote")
async def parse_commercial_quote(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    file_bytes = await file.read()

    try:
        await store_uploaded_pdf(
            file_data=file_bytes,
            file_name=file.filename or "commercial_quote.pdf",
            insurance_type="commercial",
        )
    except Exception:
        pass

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(file_bytes)

    def event_stream():
        try:
            yield from stream_commercial_quote_with_gemini(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
    )
