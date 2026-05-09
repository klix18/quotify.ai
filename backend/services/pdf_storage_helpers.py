"""
Shared helpers for storing uploaded and generated PDFs in the database.
Import these into parser and filler APIs to auto-save documents.
"""

from pathlib import Path
from typing import Union

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
    pdf_path: Union[Path, bytes],
    file_name: str,
    insurance_type: str,
    client_name: str = "",
    user_id: str = "",
    user_name: str = "",
) -> str:
    """Store a generated quote PDF. Returns the document UUID.

    Accepts either a ``Path`` (legacy on-disk callers) or raw ``bytes``
    (new in-memory rendering path) for ``pdf_path`` so existing call
    sites don't break during the migration.
    """
    if isinstance(pdf_path, (bytes, bytearray)):
        file_data = bytes(pdf_path)
    else:
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
