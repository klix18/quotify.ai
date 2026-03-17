from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, BooleanObject


router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_PDF_PATH = BASE_DIR / "templates" / "homeowners_quote_template.pdf"
GENERATED_DIR = BASE_DIR / "generated_quotes"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)


FIELD_MAP = {
    "total_premium": "total-premium",
    "dwelling": "dwelling",
    "of_dwelling": "of-dwelling",
    "other_structures": "other-structures",
    "personal_property": "personal-property",
    "loss_of_use": "loss-of-use",
    "personal_liability": "personal-liability",
    "medical_payments": "medical-payments",
    "all_perils_deductible": "all-perils-deductible",
    "wind_hail_deductible": "wind-hail-deductible",
    "water_and_sewer_backup": "water-and-sewer-backup",
    "client_name": "client-name",
    "client_address": "client-address",
    "client_phone": "client-phone",
    "client_email": "client-email",
    "agent_name": "agent-name",
    "agent_address": "agent-address",
    "agent_phone": "agent-phone",
    "agent_email": "agent-email",
    "replacement_cost_on_contents": "replacement-cost-on-contents",
    "25_extended_replacement_cost": "25-extended-replacement-cost",
}


def fill_branded_pdf(template_pdf_path: Path, output_pdf_path: Path, parsed_data: dict):
    reader = PdfReader(str(template_pdf_path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    form_values = {}
    for parsed_key, pdf_field_name in FIELD_MAP.items():
        value = parsed_data.get(parsed_key, "")
        if value is None:
            value = ""
        form_values[pdf_field_name] = str(value)

    root = writer._root_object
    if "/AcroForm" not in root:
        raise ValueError(
            "This PDF does not contain a usable AcroForm. "
            "Re-save the template as a proper fillable PDF in Acrobat."
        )

    root[NameObject("/AcroForm")][NameObject("/NeedAppearances")] = BooleanObject(True)

    for page in writer.pages:
        writer.update_page_form_field_values(page, form_values)

    with open(output_pdf_path, "wb") as f:
        writer.write(f)


@router.post("/api/generate-homeowners-quote")
async def generate_homeowners_quote(payload: dict):
    if not TEMPLATE_PDF_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Template not found at: {TEMPLATE_PDF_PATH}",
        )

    try:
        output_path = GENERATED_DIR / f"homeowners_quote_{uuid4().hex}.pdf"

        fill_branded_pdf(
            template_pdf_path=TEMPLATE_PDF_PATH,
            output_pdf_path=output_path,
            parsed_data=payload,
        )

        from datetime import datetime

        client_name = str(payload.get("client_name", "")).strip()

        # format date MM-DD-YYYY
        date_str = datetime.now().strftime("%m-%d-%Y")

        # format client name Kevin-Li
        safe_client = "Unknown"
        if client_name:
            safe_client = "-".join(client_name.split())

        download_name = f"homeowners_quote_{date_str}_{safe_client}.pdf"

        return FileResponse(
            path=output_path,
            media_type="application/pdf",
            filename=download_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))