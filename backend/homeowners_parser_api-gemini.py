#Uses Gemini Flash 2.5
#Shows different states, like ingesting pdf, analyzing, etc
#Only starts streaming in the last stage, not analyzing, which is the longest phase


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
    "carrier",
    "total_premium",
    "dwelling",
    "of_dwelling",
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
        "carrier": {"type": "string"},
        "total_premium": {"type": "string"},
        "dwelling": {"type": "string"},
        "of_dwelling": {"type": "string"},
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
    },
    "required": [
        "carrier",
        "total_premium",
        "dwelling",
        "of_dwelling",
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
    ],
}


SYSTEM_PROMPT = """
You extract structured data from homeowners insurance quote PDFs.

Rules:
- Return only the requested JSON fields.
- If a field cannot be found, return "".
- Preserve money formatting with a leading $ when the source is a money amount.
  Examples: "$1,015.00", "$153,814", "$2,500".
- Preserve percent formatting with a trailing % when the source is a percent.
  Examples: "10%", "25%".
- For deductible fields that combine percent and dollars, preserve both if present.
  Example: "2% - $3,076".
- replacement_cost_on_contents must be "Yes", "No", or "".
- 25_extended_replacement_cost must be "Yes", "No", or "".
- Do not infer agent info unless clearly present.
- client_address should be a single line string.
- Use the quote's actual insured / prepared-for person as client_name, not the agency.
- For of_dwelling:
  - only populate it if the quote explicitly states a percent amount for that field
  - otherwise return "".
- If an endorsement indicates 25% extended replacement cost is included, set
  25_extended_replacement_cost to "Yes", not of_dwelling.
"""


def normalize_homeowners_result(parsed: dict) -> dict:
    for key in ALL_HOMEOWNERS_KEYS:
        parsed.setdefault(key, "")
        if parsed[key] is None:
            parsed[key] = ""
    return parsed


def extract_partial_fields(streamed_json: str) -> dict:
    """
    Pulls completed key/value pairs out of an incomplete JSON string.
    Only extracts fields whose string value is fully closed.
    """
    partial = {}

    for key in ALL_HOMEOWNERS_KEYS:
        pattern = rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"'
        match = re.search(pattern, streamed_json)
        if match:
            value = match.group(1)
            value = value.replace('\\"', '"').replace("\\\\", "\\")
            partial[key] = value

    return partial


def stream_homeowners_quote_with_gemini(
    pdf_path: Path,
    model: str = "gemini-2.5-flash",
) -> Iterator[str]:
    client = get_gemini_client()
    uploaded_file = None

    try:
        uploaded_file = client.files.upload(
            file=str(pdf_path),
            config={"mime_type": "application/pdf"},
        )

        yield json.dumps({"type": "status", "message": "Analyzing document..."}) + "\n"

        full_text = ""
        sent_values = {}

        stream = client.models.generate_content_stream(
            model=model,
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

        for chunk in stream:
            text = chunk.text or ""
            if not text:
                continue

            full_text += text

            yield json.dumps({"type": "delta", "text": text}) + "\n"

            partial = extract_partial_fields(full_text)
            patch = {}

            for key, value in partial.items():
                if sent_values.get(key) != value:
                    sent_values[key] = value
                    patch[key] = value

            if patch:
                yield json.dumps({"type": "patch", "data": patch}) + "\n"

        parsed = json.loads(full_text)
        parsed = normalize_homeowners_result(parsed)

        final_patch = {}
        for key, value in parsed.items():
            if sent_values.get(key) != value:
                final_patch[key] = value

        if final_patch:
            yield json.dumps({"type": "patch", "data": final_patch}) + "\n"

        yield json.dumps({"type": "result", "data": parsed}) + "\n"

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