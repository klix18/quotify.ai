from pathlib import Path
from uuid import uuid4
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from jinja2 import Environment, FileSystemLoader
from browser_manager import get_browser
from pdf_optimizer import optimize_pdf
from pdf_storage_helpers import store_generated_pdf

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_ROOT = BASE_DIR / "templates"
TEMPLATE_DIR = TEMPLATES_ROOT / "bundle"
GENERATED_DIR = BASE_DIR / "generated_quotes"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_ROOT)))


async def render_bundle_pdf(output_path: Path, data: dict):
    """Render the bundle HTML template with data and convert to PDF."""
    template = jinja_env.get_template("bundle/bundle_quote.html")

    coverages = data.get("coverages", {})

    context = {
        # Bundle premiums
        "bundle_total_premium": data.get("bundle_total_premium", ""),
        "home_premium": data.get("home_premium", ""),
        "auto_premium": data.get("auto_premium", ""),
        "why_selected": data.get("why_selected", ""),
        # Client / Agent
        "client_name": data.get("client_name", ""),
        "client_address": data.get("client_address", ""),
        "client_phone": data.get("client_phone", ""),
        "client_email": data.get("client_email", ""),
        "agent_name": data.get("agent_name", ""),
        "agent_address": data.get("agent_address", ""),
        "agent_phone": data.get("agent_phone", ""),
        "agent_email": data.get("agent_email", ""),
        # Homeowners coverages
        "dwelling": data.get("dwelling", ""),
        "other_structures": data.get("other_structures", ""),
        "personal_property": data.get("personal_property", ""),
        "loss_of_use": data.get("loss_of_use", ""),
        "personal_liability": data.get("personal_liability", ""),
        "medical_payments": data.get("medical_payments", ""),
        "all_perils_deductible": data.get("all_perils_deductible", ""),
        "wind_hail_deductible": data.get("wind_hail_deductible", ""),
        "water_and_sewer_backup": data.get("water_and_sewer_backup", ""),
        "replacement_cost_on_contents": data.get("replacement_cost_on_contents", ""),
        "extended_replacement_cost": data.get("25_extended_replacement_cost", ""),
        # Auto coverages (policy-level)
        "bi_limit": coverages.get("bi_limit", ""),
        "pd_limit": coverages.get("pd_limit", ""),
        "medpay_limit": coverages.get("medpay_limit", ""),
        "um_uim_bi_limit": coverages.get("um_uim_bi_limit", ""),
        "umpd_limit": coverages.get("umpd_limit", ""),
        "umpd_deductible": coverages.get("umpd_deductible", ""),
        "comprehensive_deductible": coverages.get("comprehensive_deductible", ""),
        "collision_deductible": coverages.get("collision_deductible", ""),
        "rental_limit": coverages.get("rental_limit", ""),
        "towing_limit": coverages.get("towing_limit", ""),
        # Drivers & Vehicles
        "drivers": data.get("drivers", []),
        "vehicles": data.get("vehicles", []),
        # Payment options
        "payment_options": data.get("payment_options", {}),
    }

    html_string = template.render(**context)

    tmp_html = TEMPLATE_DIR / f"_tmp_render_{uuid4().hex}.html"
    tmp_html.write_text(html_string, encoding="utf-8")

    browser = await get_browser()
    page = await browser.new_page()
    try:
        await page.goto(tmp_html.resolve().as_uri(), wait_until="networkidle")
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


@router.post("/api/generate-bundle-quote")
async def generate_bundle_quote(payload: dict):
    try:
        output_path = GENERATED_DIR / f"bundle_quote_{uuid4().hex}.pdf"

        await render_bundle_pdf(output_path=output_path, data=payload)

        client_name = str(payload.get("client_name", "")).strip()
        date_str = datetime.now().strftime("%m-%d-%Y")
        safe_client = "-".join(client_name.split()) if client_name else "Unknown"
        download_name = f"bundle_quote_{date_str}_{safe_client}.pdf"

        # Store generated PDF in database
        try:
            await store_generated_pdf(
                pdf_path=output_path,
                file_name=download_name,
                insurance_type="bundle",
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
