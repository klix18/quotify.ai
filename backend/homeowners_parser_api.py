import json
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, File, UploadFile, HTTPException
from openai import OpenAI

load_dotenv()


router = APIRouter()


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set. Add it to your .env file or environment.")
    return OpenAI(api_key=api_key)


HOMEOWNERS_SCHEMA = {
    "name": "homeowners_quote",
    "schema": {
        "type": "object",
        "additionalProperties": False,
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
            # NOTE: agent_* fields are intentionally omitted from the AI schema
            # so they remain manual-entry only in the UI.
            "replacement_cost_on_contents": {
                "type": "string",
                "enum": ["Yes", "No", ""]
            },
            "25_extended_replacement_cost": {
                "type": "string",
                "enum": ["Yes", "No", ""]
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
            "replacement_cost_on_contents",
            "25_extended_replacement_cost",
        ],
    },
    "strict": True,
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


def parse_homeowners_quote_with_ai(pdf_path: Path, model: str = "gpt-4o-mini") -> dict:
    client = get_openai_client()

    with pdf_path.open("rb") as f:
        uploaded = client.files.create(
            file=f,
            purpose="user_data",
        )

    try:
        response = client.responses.create(
            model=model,
            input=[
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": SYSTEM_PROMPT}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Extract the homeowners insurance quote fields from this PDF.",
                        },
                        {
                            "type": "input_file",
                            "file_id": uploaded.id,
                        },
                    ],
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": HOMEOWNERS_SCHEMA["name"],
                    "schema": HOMEOWNERS_SCHEMA["schema"],
                    "strict": HOMEOWNERS_SCHEMA["strict"],
                }
            },
        )

        parsed = json.loads(response.output_text)

        for key in HOMEOWNERS_SCHEMA["schema"]["required"]:
            parsed.setdefault(key, "")
            if parsed[key] is None:
                parsed[key] = ""

        return parsed

    finally:
        try:
            client.files.delete(uploaded.id)
        except Exception:
            pass


@router.post("/api/parse-homeowners-quote")
async def parse_homeowners_quote(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await file.read())

    try:
        parsed = parse_homeowners_quote_with_ai(temp_path)
        return parsed
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)