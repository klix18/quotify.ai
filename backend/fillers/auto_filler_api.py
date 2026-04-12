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

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_ROOT = BASE_DIR / "templates"
TEMPLATE_DIR = TEMPLATES_ROOT / "auto"
GENERATED_DIR = BASE_DIR / "generated_quotes"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_ROOT)))


async def render_auto_pdf(output_path: Path, data: dict):
    """Render the auto HTML template with data and convert to PDF."""
    template = jinja_env.get_template("auto/auto_quote.html")

    coverages = data.get("coverages", {})

    context = {
        "total_premium": data.get("total_premium", ""),
        "policy_term": data.get("policy_term", ""),
        "quote_date": data.get("quote_date", ""),
        "quote_effective_date": data.get("quote_effective_date", ""),
        "quote_expiration_date": data.get("quote_expiration_date", ""),
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
        # Coverages (policy-level)
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
        # Drivers & Vehicles (arrays passed through)
        "drivers": data.get("drivers", []),
        "vehicles": data.get("vehicles", []),
        # Payment options (nested dict passed through)
        "payment_options": data.get("payment_options", {}),
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


@router.post("/api/generate-auto-quote")
async def generate_auto_quote(payload: dict):
    try:
        output_path = GENERATED_DIR / f"auto_quote_{uuid4().hex}.pdf"

        await render_auto_pdf(output_path=output_path, data=payload)

        client_name = str(payload.get("client_name", "")).strip()
        date_str = datetime.now().strftime("%m-%d-%Y")
        safe_client = "-".join(client_name.split()) if client_name else "Unknown"
        download_name = f"auto_quote_{date_str}_{safe_client}.pdf"

        # Store generated PDF in database
        try:
            await store_generated_pdf(
                pdf_path=output_path,
                file_name=download_name,
                insurance_type="auto",
                client_name=client_name,
            )
        except Exception:
            pass  # Don't fail the response if storage fails

        return FileResponse(
            path=output_path,
            media_type="application/pdf",
            filename=download_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
