"""
Shared helpers for storing uploaded and generated PDFs in the database.
Import these into parser and filler APIs to auto-save documents.
"""

from pathlib import Path

from core.database import store_pdf


async def store_uploaded_pdf(
    file_data: bytes,
    file_name: str,
    insurance_type: str,
    client_name: str = "",
    user_id: str = "",
    user_name: str = "",
) -> str:
    """Store an uploaded (extracted) PDF. Returns the document UUID."""
    return await store_pdf(
        file_data=file_data,
        file_name=file_name,
        insurance_type=insurance_type,
        doc_type="uploaded",
        user_id=user_id,
        user_name=user_name,
        client_name=client_name,
    )


async def store_generated_pdf(
    pdf_path: Path,
    file_name: str,
    insurance_type: str,
    client_name: str = "",
    user_id: str = "",
    user_name: str = "",
) -> str:
    """Store a generated quote PDF. Reads the file from disk. Returns the document UUID."""
    file_data = pdf_path.read_bytes()
    return await store_pdf(
        file_data=file_data,
        file_name=file_name,
        insurance_type=insurance_type,
        doc_type="generated",
        user_id=user_id,
        user_name=user_name,
        client_name=client_name,
    )
