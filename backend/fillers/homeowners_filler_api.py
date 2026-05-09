from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader
from core.auth import get_current_user, user_name_for_attribution
from core.browser_manager import get_browser
from services.pdf_optimizer import optimize_pdf_bytes
from services.pdf_storage_helpers import store_generated_pdf
from fillers._filename import build_pdf_filename

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_ROOT = BASE_DIR / "templates"
TEMPLATE_DIR = TEMPLATES_ROOT / "homeowners"

# Jinja2 env points at templates/ root so base.html inheritance resolves
jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_ROOT)))


async def render_homeowners_pdf(data: dict) -> bytes:
    """Render the homeowners HTML template with data and return PDF bytes."""
    template = jinja_env.get_template("homeowners/homeowners_quote.html")

    context = {
        "total_premium": data.get("total_premium", ""),
        "policy_term": data.get("policy_term", ""),
        "quote_date": data.get("quote_date", ""),
        "quote_effective_date": data.get("quote_effective_date", ""),
        "quote_expiration_date": data.get("quote_expiration_date", ""),
        "why_selected": data.get("why_selected", ""),
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
        "client_name": data.get("client_name", ""),
        "client_address": data.get("client_address", ""),
        "client_phone": data.get("client_phone", ""),
        "client_email": data.get("client_email", ""),
        "agent_name": data.get("agent_name", ""),
        "agent_address": data.get("agent_address", ""),
        "agent_phone": data.get("agent_phone", ""),
        "agent_email": data.get("agent_email", ""),
    }

    html_string = template.render(**context)

    # Write rendered HTML to a temp file in the template directory so
    # Chromium can resolve all relative paths (assets/, fonts/) natively.
    # set_content() loads from about:blank which blocks file:// URIs.
    tmp_html = TEMPLATE_DIR / f"_tmp_render_{uuid4().hex}.html"
    tmp_html.write_text(html_string, encoding="utf-8")

    browser = await get_browser()
    page = await browser.new_page()
    try:
        await page.goto(tmp_html.resolve().as_uri(), wait_until="domcontentloaded")
        # Wait for all @font-face fonts to finish loading before PDF
        # generation — file:// font loads don't trigger networkidle.
        await page.evaluate("() => document.fonts.ready")
        pdf_bytes = await page.pdf(
            prefer_css_page_size=True,
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
    finally:
        await page.close()
        tmp_html.unlink(missing_ok=True)

    return optimize_pdf_bytes(pdf_bytes)


@router.post("/api/generate-homeowners-quote")
async def generate_homeowners_quote(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    try:
        pdf_bytes = await render_homeowners_pdf(payload)

        client_name = str(payload.get("client_name", "")).strip()
        download_name = build_pdf_filename(
            insurance_type="homeowners",
            client_name=client_name,
            total_premium=payload.get("total_premium", ""),
        )

        try:
            await store_generated_pdf(
                pdf_path=pdf_bytes,
                file_name=download_name,
                insurance_type="homeowners",
                client_name=client_name,
                user_id=user.get("user_id", ""),
                user_name=user_name_for_attribution(user),
            )
        except Exception:
            pass

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"',
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
