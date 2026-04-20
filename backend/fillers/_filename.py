"""
_filename.py
============
Shared helper for PDF download filenames.

All insurance-type filler APIs use the same naming convention:

    {Type} - {mm/dd/yyyy} - {Client Name} - ${premium}.pdf

Examples:
    "Auto - 12/13/2002 - Kevin Li - $1298.pdf"
    "Homeowners - 03/25/2026 - David Xu - $129.pdf"

The client name is always Title Case ("First Last"), matching how it is
stored after parsing (see backend/parsers/post_process.py).
"""

from __future__ import annotations

from datetime import datetime

from parsers.post_process import _titlecase_name


# Pretty display label for each insurance type as it appears in the PDF
# filename's first segment.
TYPE_LABELS: dict[str, str] = {
    "auto": "Auto",
    "homeowners": "Homeowners",
    "dwelling": "Dwelling",
    "commercial": "Commercial",
    "bundle": "Bundle",
}


def _format_premium(raw) -> str:
    """Return the premium as ``$1234`` (integer) or ``$1234.50`` (decimal).

    Accepts messy inputs like ``"$1,298.00"``, ``"1298"``, or ``1298.5`` and
    normalizes them. Falls back to ``$0`` on empty / unparseable input.
    """
    if raw is None:
        return "$0"
    s = str(raw).replace("$", "").replace(",", "").strip()
    if not s:
        return "$0"
    try:
        val = float(s)
    except (ValueError, TypeError):
        # Couldn't parse — echo back whatever was there, prefixed with $.
        return f"${s}"
    if val == int(val):
        return f"${int(val)}"
    return f"${val:.2f}"


def _safe_client_name(name) -> str:
    """Return a Title-Cased client name, or "Unknown Client" if blank."""
    name_str = str(name or "").strip()
    if not name_str:
        return "Unknown Client"
    return _titlecase_name(name_str)


def build_pdf_filename(insurance_type: str, client_name, total_premium) -> str:
    """
    Build a PDF download filename in the canonical format:

        "{Type} - {mm/dd/yyyy} - {Client Name} - ${premium}.pdf"

    Parameters
    ----------
    insurance_type : str
        One of ``auto``, ``homeowners``, ``dwelling``, ``commercial``, ``bundle``.
    client_name : str
        The insured / named-insured. Will be Title-Cased ("Kevin Li").
    total_premium : str | number
        The total premium (accepts ``"$1,298.00"``, ``"1298"``, ``1298.5``, …).
    """
    label = TYPE_LABELS.get(insurance_type.lower().strip(), insurance_type.title())
    date_str = datetime.now().strftime("%m-%d-%Y")
    client = _safe_client_name(client_name)
    premium = _format_premium(total_premium)
    return f"{label} · {date_str} · {client} · {premium}.pdf"
