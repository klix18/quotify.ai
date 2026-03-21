# auto_parser_api.py
# Uses Gemini Flash 2.5
# 2 pass extraction for auto insurance quotes:
# pass 1 = fast draft extraction
# pass 2 = strict structured verification

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


AUTO_SCHEMA = {
    "type": "object",
    "properties": {
        "named_insured": {"type": "string"},
        "mailing_address": {"type": "string"},
        "phone_number": {"type": "string"},
        "quote_effective_date": {"type": "string"},
        "quote_expiration_date": {"type": "string"},
        "policy_term": {"type": "string"},

        "drivers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "driver_name": {"type": "string"},
                    "license_state": {"type": "string"},
                },
                "required": ["driver_name", "license_state"],
            },
        },

        "vehicles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "year_make_model": {"type": "string"},
                    "vin": {"type": "string"},
                    "garaging_zip_county": {"type": "string"},
                    "lienholder_loss_payee": {"type": "string"},
                    "vehicle_subtotal": {"type": "string"},
                    "vehicle_discounts": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "coverages": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "coverage_name": {"type": "string"},
                                "limit": {"type": "string"},
                                "deductible": {"type": "string"},
                                "premium": {"type": "string"},
                                "status": {"type": "string"},
                            },
                            "required": [
                                "coverage_name",
                                "limit",
                                "deductible",
                                "premium",
                                "status",
                            ],
                        },
                    },
                },
                "required": [
                    "year_make_model",
                    "vin",
                    "garaging_zip_county",
                    "lienholder_loss_payee",
                    "vehicle_subtotal",
                    "vehicle_discounts",
                    "coverages",
                ],
            },
        },

        "policy_level_coverages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "coverage_name": {"type": "string"},
                    "limit": {"type": "string"},
                    "deductible": {"type": "string"},
                    "premium": {"type": "string"},
                    "status": {"type": "string"},
                },
                "required": ["coverage_name", "limit", "deductible", "premium", "status"],
            },
        },

        "premium_summary": {
            "type": "object",
            "properties": {
                "policy_level_subtotal": {"type": "string"},
                "term_premium_total": {"type": "string"},
                "policy_fees": {"type": "string"},
                "total_cost": {"type": "string"},
                "pay_in_full_premium": {"type": "string"},
                "paid_in_full_discount_amount": {"type": "string"},
                "monthly_installment_amount": {"type": "string"},
                "down_payment_amount": {"type": "string"},
                "number_of_remaining_installments": {"type": "string"},
                "installment_fee_standard": {"type": "string"},
                "installment_fee_eft": {"type": "string"},
            },
            "required": [
                "policy_level_subtotal",
                "term_premium_total",
                "policy_fees",
                "total_cost",
                "pay_in_full_premium",
                "paid_in_full_discount_amount",
                "monthly_installment_amount",
                "down_payment_amount",
                "number_of_remaining_installments",
                "installment_fee_standard",
                "installment_fee_eft",
            ],
        },

        "discounts": {
            "type": "object",
            "properties": {
                "policy_level": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "vehicle_level": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "available_not_applied": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["policy_level", "vehicle_level", "available_not_applied"],
        },
    },
    "required": [
        "named_insured",
        "mailing_address",
        "phone_number",
        "quote_effective_date",
        "quote_expiration_date",
        "policy_term",
        "drivers",
        "vehicles",
        "policy_level_coverages",
        "premium_summary",
        "discounts",
    ],
}


SYSTEM_PROMPT = """
You extract structured data from auto insurance quote PDFs.

Rules:
- Return only the requested JSON object.
- If a field cannot be found, return "" for strings and [] for arrays.
- Preserve money formatting with a leading $ when the source is monetary.
- Preserve limits as shown in the quote.
- Preserve deductibles as shown in the quote.
- For coverages marked Not Selected or Declined, capture them with status set to "Not Selected" or "Declined".
- If a coverage is active/quoted, status may be "Selected" or "".
- Mailing address should be a single-line string.
- Policy term should be captured as shown, such as "6-month" or "12-month".
- Drivers must be returned as separate array items.
- Vehicles must be returned as separate array items.
- Vehicle coverages must stay attached to the correct vehicle.
- Policy-level coverages must not be mixed into vehicle coverages.
- Discounts listed as available but not applied should go into discounts.available_not_applied.
- Do not invent missing vehicles, drivers, limits, or premiums.
"""


QUICK_PASS_PROMPT = """
Extract likely auto insurance quote fields quickly.

Return ONLY valid JSON in this shape:
{
  "named_insured": "",
  "mailing_address": "",
  "phone_number": "",
  "quote_effective_date": "",
  "quote_expiration_date": "",
  "policy_term": "",
  "drivers": [],
  "vehicles": [],
  "policy_level_coverages": [],
  "premium_summary": {},
  "discounts": {}
}

Rules:
- Prefer speed over perfection.
- Include any likely drivers and vehicles you can identify.
- Keep vehicle coverages attached to the correct vehicle if possible.
- Do not explain anything.
"""


def normalize_auto_result(parsed: dict) -> dict:
    parsed.setdefault("named_insured", "")
    parsed.setdefault("mailing_address", "")
    parsed.setdefault("phone_number", "")
    parsed.setdefault("quote_effective_date", "")
    parsed.setdefault("quote_expiration_date", "")
    parsed.setdefault("policy_term", "")
    parsed.setdefault("drivers", [])
    parsed.setdefault("vehicles", [])
    parsed.setdefault("policy_level_coverages", [])
    parsed.setdefault("premium_summary", {})
    parsed.setdefault("discounts", {})

    premium_summary = parsed["premium_summary"] or {}
    discounts = parsed["discounts"] or {}

    parsed["premium_summary"] = {
        "policy_level_subtotal": premium_summary.get("policy_level_subtotal", ""),
        "term_premium_total": premium_summary.get("term_premium_total", ""),
        "policy_fees": premium_summary.get("policy_fees", ""),
        "total_cost": premium_summary.get("total_cost", ""),
        "pay_in_full_premium": premium_summary.get("pay_in_full_premium", ""),
        "paid_in_full_discount_amount": premium_summary.get("paid_in_full_discount_amount", ""),
        "monthly_installment_amount": premium_summary.get("monthly_installment_amount", ""),
        "down_payment_amount": premium_summary.get("down_payment_amount", ""),
        "number_of_remaining_installments": premium_summary.get("number_of_remaining_installments", ""),
        "installment_fee_standard": premium_summary.get("installment_fee_standard", ""),
        "installment_fee_eft": premium_summary.get("installment_fee_eft", ""),
    }

    parsed["discounts"] = {
        "policy_level": discounts.get("policy_level", []) or [],
        "vehicle_level": discounts.get("vehicle_level", []) or [],
        "available_not_applied": discounts.get("available_not_applied", []) or [],
    }

    return parsed


def extract_partial_json_root(streamed_json: str) -> dict:
    try:
        return json.loads(streamed_json)
    except Exception:
        pass

    start = streamed_json.find("{")
    end = streamed_json.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = streamed_json[start:end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return {}

    return {}


def stream_auto_quote_with_gemini(
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

        yield json.dumps({"type": "status", "message": "Reading auto quote..."}) + "\n"

        # Pass 1
        quick_text = ""
        quick_stream = client.models.generate_content_stream(
            model=model_quick,
            contents=[
                "Quickly extract likely fields from this auto insurance quote PDF.",
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
            partial = extract_partial_json_root(quick_text)
            if partial:
                yield json.dumps({
                    "type": "draft_patch",
                    "data": partial,
                }) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted auto fields..."}) + "\n"

        # Pass 2
        full_text = ""
        final_stream = client.models.generate_content_stream(
            model=model_final,
            contents=[
                "Extract the auto insurance quote fields from this PDF.",
                uploaded_file,
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=AUTO_SCHEMA,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue

            full_text += text
            partial = extract_partial_json_root(full_text)
            if partial:
                yield json.dumps({
                    "type": "final_patch",
                    "data": partial,
                }) + "\n"

        parsed = json.loads(full_text)
        parsed = normalize_auto_result(parsed)

        yield json.dumps({"type": "result", "data": parsed}) + "\n"

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

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await file.read())

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