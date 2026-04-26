from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from jinja2 import Environment, FileSystemLoader
from core.browser_manager import get_browser
from services.pdf_optimizer import optimize_pdf
from services.pdf_storage_helpers import store_generated_pdf
from fillers._filename import build_pdf_filename

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_ROOT = BASE_DIR / "templates"
TEMPLATE_DIR = TEMPLATES_ROOT / "commercial"
GENERATED_DIR = BASE_DIR / "generated_quotes"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_ROOT)))


async def render_commercial_pdf(output_path: Path, data: dict):
    """Render the commercial HTML template with data and convert to PDF."""
    template = jinja_env.get_template("commercial/commercial_quote.html")

    context = {
        # Policy
        "total_premium": data.get("total_premium", ""),
        "policy_term": data.get("policy_term", ""),
        "quote_date": data.get("quote_date", ""),
        "quote_effective_date": data.get("quote_effective_date", ""),
        "quote_expiration_date": data.get("quote_expiration_date", ""),
        "additional_premiums_taxes_fees": data.get("additional_premiums_taxes_fees", ""),
        "why_selected": data.get("why_selected", ""),
        # Client / Agent
        # NOTE: base.html renders {{ client_name }} / {{ client_address }} —
        # commercial uses "named_insured" / "mailing_address" as canonical
        # field names, so alias both so the template's Client Information
        # block populates correctly.
        "named_insured": data.get("named_insured", ""),
        "client_name": data.get("named_insured", "") or data.get("client_name", ""),
        "mailing_address": data.get("mailing_address", ""),
        "client_address": data.get("mailing_address", "") or data.get("client_address", ""),
        "client_phone": data.get("client_phone", ""),
        "client_email": data.get("client_email", ""),
        "agent_name": data.get("agent_name", ""),
        "agent_address": data.get("agent_address", ""),
        "agent_phone": data.get("agent_phone", ""),
        "agent_email": data.get("agent_email", ""),
        # Commercial Property
        "building_limit": data.get("building_limit", ""),
        "building_deductible": data.get("building_deductible", ""),
        "bpp_limit": data.get("bpp_limit", ""),
        "bpp_deductible": data.get("bpp_deductible", ""),
        "stretch_blanket": data.get("stretch_blanket", ""),
        "business_income": data.get("business_income", ""),
        "business_income_waiting_period": data.get("business_income_waiting_period", ""),
        "equipment_breakdown": data.get("equipment_breakdown", ""),
        "back_up_sewers_drains": data.get("back_up_sewers_drains", ""),
        "ordinance_or_law": data.get("ordinance_or_law", ""),
        "wind_hail_deductible": data.get("wind_hail_deductible", ""),
        # General Liability
        "gl_each_occurrence": data.get("gl_each_occurrence", ""),
        "gl_general_aggregate": data.get("gl_general_aggregate", ""),
        "gl_products_completed_ops_aggregate": data.get("gl_products_completed_ops_aggregate", ""),
        "gl_medical_expenses": data.get("gl_medical_expenses", ""),
        "gl_damage_to_premises_rented": data.get("gl_damage_to_premises_rented", ""),
        "gl_personal_advertising_injury": data.get("gl_personal_advertising_injury", ""),
        # Workers' Compensation
        "wc_bi_accident_each_accident": data.get("wc_bi_accident_each_accident", ""),
        "wc_bi_disease_policy_limit": data.get("wc_bi_disease_policy_limit", ""),
        "wc_bi_disease_each_employee": data.get("wc_bi_disease_each_employee", ""),
        "wc_class_codes": data.get("wc_class_codes", []),
        # Excess / Umbrella
        "umbrella_each_occurrence": data.get("umbrella_each_occurrence", ""),
        "umbrella_aggregate": data.get("umbrella_aggregate", ""),
        # Cyber Liability
        "cyber_aggregate_limit": data.get("cyber_aggregate_limit", ""),
        "cyber_deductible": data.get("cyber_deductible", ""),
        "cyber_breach_response": data.get("cyber_breach_response", ""),
        "cyber_business_interruption": data.get("cyber_business_interruption", ""),
        "cyber_cyber_extortion": data.get("cyber_cyber_extortion", ""),
        "cyber_funds_transfer_fraud": data.get("cyber_funds_transfer_fraud", ""),
        "cyber_regulatory_defense": data.get("cyber_regulatory_defense", ""),
        "cyber_media_tech_liability": data.get("cyber_media_tech_liability", ""),
        # Wind Insurance
        "wind_coverage": data.get("wind_coverage", ""),
        "wind_deductible": data.get("wind_deductible", ""),
        "wind_percent_deductible": data.get("wind_percent_deductible", ""),
        "wind_coverage_premium": data.get("wind_coverage_premium", ""),
        "wind_buydown": data.get("wind_buydown", ""),
        "wind_buydown_amount": data.get("wind_buydown_amount", ""),
        "wind_buydown_premium": data.get("wind_buydown_premium", ""),
    }

    html_string = template.render(**context)

    tmp_html = TEMPLATE_DIR / f"_tmp_render_{uuid4().hex}.html"
    tmp_html.write_text(html_string, encoding="utf-8")

    browser = await get_browser()
    page = await browser.new_page()
    try:
        await page.goto(tmp_html.resolve().as_uri(), wait_until="domcontentloaded")
        await page.evaluate("() => document.fonts.ready")
        await page.pdf(
            path=str(output_path),
            prefer_css_page_size=True,
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
    finally:
        await page.close()
        tmp_html.unlink(missing_ok=True)

    # Re-distill through Ghostscript to flatten Chromium's internal layers
    optimize_pdf(output_path)


@router.post("/api/generate-commercial-quote")
async def generate_commercial_quote(payload: dict):
    try:
        output_path = GENERATED_DIR / f"commercial_quote_{uuid4().hex}.pdf"

        await render_commercial_pdf(output_path=output_path, data=payload)

        client_name = str(payload.get("named_insured", "")).strip()
        download_name = build_pdf_filename(
            insurance_type="commercial",
            client_name=client_name,
            total_premium=payload.get("total_premium", ""),
        )

        # Store generated PDF in database
        try:
            await store_generated_pdf(
                pdf_path=output_path,
                file_name=download_name,
                insurance_type="commercial",
                client_name=client_name,
            )
        except Exception:
            pass

        return FileResponse(
            path=output_path,
            media_type="application/pdf",
            filename=download_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
