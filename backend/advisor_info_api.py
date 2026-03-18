from pathlib import Path
from typing import List, Dict

import pandas as pd
from fastapi import APIRouter, HTTPException

BASE_DIR = Path(__file__).resolve().parent
ADVISOR_EXCEL_PATH = BASE_DIR / "advisor_info_list" / "advisor_info_list.xlsx"

router = APIRouter()


def clean_cell(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def _load_advisors() -> List[Dict[str, str]]:
    if not ADVISOR_EXCEL_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Advisor info file not found at: {ADVISOR_EXCEL_PATH}",
        )

    try:
        df = pd.read_excel(ADVISOR_EXCEL_PATH)
        print("Advisor Excel path:", ADVISOR_EXCEL_PATH)
        print("Advisor Excel columns:", df.columns.tolist())
        print("Advisor row count:", len(df))
    except Exception as exc:
        print("READ EXCEL ERROR:", repr(exc))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read advisor info file: {exc}",
        )

    print("Checking required columns...")
    required_cols = ["Name", "Office Address", "Phone", "Email"]
    for col in required_cols:
        if col not in df.columns:
            print("MISSING COLUMN:", col)
            raise HTTPException(
                status_code=500,
                detail=f"Advisor info file is missing required column: {col}",
            )

    advisors: List[Dict[str, str]] = []
    seen = set()

    for _, row in df.iterrows():
        name = clean_cell(row.get("Name", ""))
        if not name:
            continue

        key = name.lower()
        if key in seen:
            continue
        seen.add(key)

        advisors.append(
            {
                "name": name,
                "office_address": clean_cell(row.get("Office Address", "")),
                "phone": clean_cell(row.get("Phone", "")),
                "email": clean_cell(row.get("Email", "")),
            }
        )

    print("Loaded advisors:", len(advisors))
    return advisors


@router.get("/api/advisors")
async def list_advisors() -> List[Dict[str, str]]:
    return _load_advisors()


@router.get("/api/advisors/by-name")
async def get_advisor_by_name(name: str) -> Dict[str, str]:
    advisors = _load_advisors()
    for advisor in advisors:
        if advisor["name"].lower() == name.strip().lower():
            return advisor

    raise HTTPException(status_code=404, detail="Advisor not found")