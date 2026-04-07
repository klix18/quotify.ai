# wind_parser_api.py
# Dedicated wind-insurance parser endpoint.
# Uses Gemini 2-pass extraction for just the 7 wind fields.

import json
import os
import tempfile
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

from pdf_storage_helpers import store_uploaded_pdf

load_dotenv()

router = APIRouter()


def get_gemini_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set.")
    return genai.Client(api_key=api_key)


# ── Wind field keys ──────────────────────────────────────────────
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

ALL_WIND_KEYS = WIND_COVERAGE_KEYS + WIND_BUYDOWN_KEYS

# ── Schema for Pass 2 ───────────────────────────────────────────
WIND_SCHEMA = {
    "type": "object",
    "properties": {
        **{k: {"type": "string"} for k in ALL_WIND_KEYS},
        "confidence": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in ALL_WIND_KEYS},
            "required": ALL_WIND_KEYS,
        },
    },
    "required": ALL_WIND_KEYS + ["confidence"],
}

# ── Prompts ──────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are an expert wind-insurance data extractor. You receive a PDF document
related to wind insurance coverage and return a JSON object with the specified
fields.

ABSOLUTE RULE: NEVER fabricate, guess, or hallucinate values. If a field is not
explicitly printed in the document, return "" (empty string).

─── FIELD GUIDANCE ───────────────────────────────────────────────

Wind Coverage:
• wind_coverage – Wind coverage limit or description.
    ALIASES: "Wind", "Wind Coverage", "Named Storm", "Windstorm"
• wind_deductible – Wind deductible (dollar amount).
    ALIASES: "Wind Deductible", "Named Storm Deductible", "Windstorm Deductible"
• wind_percent_deductible – Wind percentage deductible (e.g., "2%", "5%").
    ALIASES: "Wind % Deductible", "Wind Percentage Deductible"
• wind_coverage_premium – Premium for wind coverage.
    ALIASES: "Wind Premium", "Named Storm Premium", "Windstorm Premium"

Wind Buydown:
• wind_buydown – Wind buydown description or limit.
    ALIASES: "Wind Buydown", "Wind Deductible Buydown", "Windstorm Buydown"
• wind_buydown_amount – Buydown amount.
    ALIASES: "Buydown Amount", "Deductible Buydown Amount"
• wind_buydown_premium – Premium for wind buydown.
    ALIASES: "Wind Buydown Premium", "Buydown Premium"

─── CONFIDENCE ────────────────────────────────────────────────────
For each field, provide a confidence score (0.0 to 1.0) in the "confidence"
object. Use 1.0 if you found the value clearly printed, lower scores for
partial matches. Use 0.0 for fields you could not find (value = "").

─── RULES ────────────────────────────────────────────────────────
• Return ONLY the JSON object. No commentary.
• If a field cannot be found, return "".
• Preserve money formatting with a leading $. Examples: "$1,250.00", "$500".
• NEVER invent or guess data.
• Read EVERY page of the document.
"""

QUICK_PASS_PROMPT = """\
You are an accurate wind-insurance data extractor.
Extract wind insurance fields from this PDF.

NEVER guess or fabricate. Only output a field if you can see the value printed.
Omit any field you cannot find.

Output ONLY lines in this exact format (one per line):
field_key: value

Keys to extract:
  wind_coverage, wind_deductible, wind_percent_deductible, wind_coverage_premium,
  wind_buydown, wind_buydown_amount, wind_buydown_premium

Field aliases to look for:
- wind_coverage: "Wind", "Wind Coverage", "Named Storm", "Windstorm"
- wind_deductible: "Wind Deductible", "Named Storm Deductible"
- wind_percent_deductible: "Wind % Deductible", "Wind Percentage Deductible"
- wind_coverage_premium: "Wind Premium", "Named Storm Premium"
- wind_buydown: "Wind Buydown", "Wind Deductible Buydown"
- wind_buydown_amount: "Buydown Amount"
- wind_buydown_premium: "Wind Buydown Premium", "Buydown Premium"

Rules:
- ONLY output values you can see in the document. NEVER guess.
- Skip fields you cannot find.
- Monetary values must have $ prefix: "$1,000,000", "$2,500"
"""


# ── Helpers ──────────────────────────────────────────────────────

def extract_quick_pass_lines(text: str) -> dict:
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value and key in ALL_WIND_KEYS:
            result[key] = value
    return result


def extract_partial_json(streamed_json: str) -> dict:
    try:
        return json.loads(streamed_json)
    except Exception:
        pass
    start = streamed_json.find("{")
    end = streamed_json.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(streamed_json[start:end + 1])
        except Exception:
            return {}
    return {}


# ── Streaming pipeline ──────────────────────────────────────────

def stream_wind_quote_with_gemini(
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

        yield json.dumps({"type": "status", "message": "Reading wind insurance document..."}) + "\n"

        # ── PASS 1: quick draft ──────────────────────────────────
        quick_text = ""
        quick_stream = client.models.generate_content_stream(
            model=model_quick,
            contents=[
                "Read this wind insurance PDF carefully. "
                "Extract all wind coverage and wind buydown fields you can find.",
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
                    yield json.dumps({"type": "draft_patch", "data": patch}) + "\n"

        yield json.dumps({"type": "status", "message": "Verifying wind fields..."}) + "\n"

        # ── PASS 2: strict structured extraction ─────────────────
        full_text = ""
        sent_final_json = ""

        final_stream = client.models.generate_content_stream(
            model=model_final,
            contents=[
                "Read this wind insurance PDF thoroughly. "
                "Extract all wind coverage and wind buydown fields into the JSON schema. "
                "Only populate fields you can actually see in the document.",
                uploaded_file,
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                response_mime_type="application/json",
                response_schema=WIND_SCHEMA,
            ),
        )

        for chunk in final_stream:
            text = chunk.text or ""
            if not text:
                continue
            full_text += text
            partial = extract_partial_json(full_text)
            if partial:
                # Extract just the wind fields (not confidence)
                wind_patch = {k: partial[k] for k in ALL_WIND_KEYS if k in partial and partial[k]}
                if wind_patch:
                    patch_json = json.dumps(wind_patch, sort_keys=True)
                    if patch_json != sent_final_json:
                        sent_final_json = patch_json
                        yield json.dumps({"type": "final_patch", "data": wind_patch}) + "\n"

        # Final result
        parsed = extract_partial_json(full_text)
        confidence = parsed.pop("confidence", {})

        final_data = {}
        for k in ALL_WIND_KEYS:
            val = parsed.get(k, "") or ""
            final_data[k] = val

        yield json.dumps({
            "type": "result",
            "data": final_data,
            "confidence": confidence,
        }) + "\n"

    except Exception as e:
        yield json.dumps({"type": "error", "error": str(e)}) + "\n"

    finally:
        if uploaded_file:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass


# ── Endpoint ─────────────────────────────────────────────────────

@router.post("/api/parse-wind-quote")
async def parse_wind_quote(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    content = await file.read()

    try:
        await store_uploaded_pdf(
            file_data=content,
            file_name=file.filename or "wind_quote.pdf",
            insurance_type="wind",
        )
    except Exception:
        pass

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    def generate():
        try:
            yield from stream_wind_quote_with_gemini(tmp_path)
        finally:
            try:
                tmp_path.unlink()
            except Exception:
                pass

    return StreamingResponse(generate(), media_type="application/x-ndjson")
