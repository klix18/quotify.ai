#Uses Gemini Flash 2.5
#Shows different states, like ingesting pdf, analyzing, etc
#2 pass - first pass: OCR+streaming, second pass:OCR+full reviewing
# this is the best!!!

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


ALL_HOMEOWNERS_KEYS = [
    "total_premium",
    "dwelling",
    "other_structures",
    "personal_property",
    "loss_of_use",
    "personal_liability",
    "medical_payments",
    "all_perils_deductible",
    "wind_hail_deductible",
    "water_and_sewer_backup",
    "client_name",
    "client_address",
    "client_phone",
    "client_email",
    "replacement_cost_on_contents",
    "25_extended_replacement_cost",
]


HOMEOWNERS_SCHEMA = {
    "type": "object",
    "properties": {
        "total_premium": {"type": "string"},
        "dwelling": {"type": "string"},
        "other_structures": {"type": "string"},
        "personal_property": {"type": "string"},
        "loss_of_use": {"type": "string"},
        "personal_liability": {"type": "string"},
        "medical_payments": {"type": "string"},
        "all_perils_deductible": {"type": "string"},
        "wind_hail_deductible": {"type": "string"},
        "water_and_sewer_backup": {"type": "string"},
        "client_name": {"type": "string"},
        "client_address": {"type": "string"},
        "client_phone": {"type": "string"},
        "client_email": {"type": "string"},
        "replacement_cost_on_contents": {
            "type": "string",
            "enum": ["Yes", "No"],
        },
        "25_extended_replacement_cost": {
            "type": "string",
            "enum": ["Yes", "No"],
        },
        "confidence": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in ALL_HOMEOWNERS_KEYS},
            "required": ALL_HOMEOWNERS_KEYS,
        },
    },
    "required": [
        "total_premium",
        "dwelling",
        "other_structures",
        "personal_property",
        "loss_of_use",
        "personal_liability",
        "medical_payments",
        "all_perils_deductible",
        "wind_hail_deductible",
        "water_and_sewer_backup",
        "client_name",
        "client_address",
        "client_phone",
        "client_email",
        "confidence",
    ],
}


SYSTEM_PROMPT = """
You extract structured data from homeowners insurance quote PDFs.

Rules:
- Return only the requested JSON fields.
- If a field cannot be found, return "".
- Preserve money formatting with a leading $ when the source is a money amount.
  Examples: "$1,015.00", "$153,814", "$2,500".
- For deductible fields that combine percent and dollars, preserve both if present.
  Example: "2% - $3,076".
- replacement_cost_on_contents must be "Yes", "No", or "".
- 25_extended_replacement_cost must be "Yes", "No", or "".
- Do not infer agent info unless clearly present.
- client_address should be a single line string.
- Use the quote's actual insured / prepared-for person as client_name, not the agency.
- If an endorsement indicates 25% extended replacement cost is included, set
  25_extended_replacement_cost to "Yes".

CONFIDENCE SCORING:
For EVERY field, provide a confidence score (0.0 to 1.0) in the "confidence"
object. The keys in "confidence" must match the data field keys exactly.

Scoring guide:
- 0.95-1.0  = value clearly printed / unambiguous on the document
- 0.85-0.94 = high confidence, minor ambiguity (e.g., slightly blurry)
- 0.60-0.84 = moderate confidence, inferred or partially visible
- 0.30-0.59 = low confidence, best guess from context
- 0.0-0.29  = very uncertain, field might not exist in document

For fields you set to "" (not found), rate how certain you are that
the field is genuinely ABSENT from the document:
- 0.90+  = thoroughly searched, field is definitely not present
- 0.50-0.89 = searched but could have missed it
- <0.50  = uncertain whether the document contains this field
"""


QUICK_PASS_PROMPT = """
Extract likely homeowners quote fields from this PDF as quickly as possible.

Output ONLY lines in this exact format:
field_key: value

Rules:
- One field per line
- Only use these field keys:
  total_premium
  dwelling
  other_structures
  personal_property
  loss_of_use
  personal_liability
  medical_payments
  all_perils_deductible
  wind_hail_deductible
  water_and_sewer_backup
  client_name
  client_address
  client_phone
  client_email
  replacement_cost_on_contents
  25_extended_replacement_cost
- Skip fields you cannot identify yet
- Do not explain anything
- Prefer speed over perfection
- replacement_cost_on_contents must be Yes or No if known
- 25_extended_replacement_cost must be Yes or No if known
- For names, always format as "First Last", never "Last, First"
"""


def normalize_homeowners_result(parsed: dict) -> tuple:
    """Ensure every expected key exists. Returns (data_dict, flat_confidence_dict)."""
    # Extract confidence before normalizing data fields
    raw_confidence = parsed.pop("confidence", {})

    for key in ALL_HOMEOWNERS_KEYS:
        parsed.setdefault(key, "")
        if parsed[key] is None:
            parsed[key] = ""

    # Flatten confidence (already flat for homeowners, but ensure float values)
    flat_confidence = {}
    if isinstance(raw_confidence, dict):
        for k, v in raw_confidence.items():
            if isinstance(v, (int, float)):
                flat_confidence[k] = float(v)

    return parsed, flat_confidence


def extract_partial_json_fields(streamed_json: str) -> dict:
    partial = {}

    for key in ALL_HOMEOWNERS_KEYS:
        pattern = rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"'
        match = re.search(pattern, streamed_json)
        if match:
            value = match.group(1)
            value = value.replace('\\"', '"').replace("\\\\", "\\")
            partial[key] = value

    return partial


def extract_quick_pass_lines(text: str) -> dict:
    found = {}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        if key in ALL_HOMEOWNERS_KEYS and value:
            found[key] = value

    return found


def clean_patch_values(data: dict) -> dict:
    cleaned = {}

    for key, value in data.items():
        if key not in ALL_HOMEOWNERS_KEYS:
            continue

        if value is None:
            continue

        value = str(value).strip()

        if key in {"replacement_cost_on_contents", "25_extended_replacement_cost"}:
            if value.lower() == "yes":
                value = "Yes"
            elif value.lower() == "no":
                value = "No"
            else:
                continue

        cleaned[key] = value

    return cleaned


def stream_homeowners_quote_with_gemini(
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

        sent_draft = {}
        sent_final = {}

        yield json.dumps({"type": "status", "message": "Reading quote..."}) + "\n"

        # PASS 1: quick draft extraction
        quick_text = ""
        quick_stream = client.models.generate_content_stream(
            model=model_quick,
            contents=[
                "Quickly extract likely fields from this homeowners quote PDF.",
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
            found = clean_patch_values(extract_quick_pass_lines(quick_text))

            patch = {}
            for key, value in found.items():
                if sent_draft.get(key) != value:
                    sent_draft[key] = value
                    patch[key] = value

            if patch:
                yield json.dumps({
                    "type": "draft_patch",
                    "data": patch,
                }) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying extracted fields..."}) + "\n"

        # PASS 2: strict structured extraction
        full_text = ""
        final_stream = client.models.generate_content_stream(
            model=model_final,
            contents=[
                "Extract the homeowners insurance quote fields from this PDF.",
                uploaded_file,
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=HOMEOWNERS_SCHEMA,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue

            full_text += text
            partial = clean_patch_values(extract_partial_json_fields(full_text))

            patch = {}
            for key, value in partial.items():
                if sent_final.get(key) != value:
                    sent_final[key] = value
                    patch[key] = value

            if patch:
                yield json.dumps({
                    "type": "final_patch",
                    "data": patch,
                }) + "\n"

        parsed = json.loads(full_text)
        data, confidence = normalize_homeowners_result(parsed)

        final_patch = {}
        for key, value in data.items():
            if sent_final.get(key) != value:
                final_patch[key] = value

        if final_patch:
            yield json.dumps({
                "type": "final_patch",
                "data": final_patch,
            }) + "\n"

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


@router.post("/api/parse-homeowners-quote")
async def parse_homeowners_quote(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await file.read())

    def event_stream():
        try:
            yield from stream_homeowners_quote_with_gemini(temp_path)
        finally:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
    )