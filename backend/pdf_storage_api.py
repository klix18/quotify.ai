"""
API endpoints for listing, downloading, and deleting stored PDF documents.
Requires authentication via Clerk JWT.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from auth import get_current_user, require_admin
from database import get_pdf, list_pdfs, delete_pdf

router = APIRouter(prefix="/api/pdfs", tags=["pdf-storage"])


@router.get("")
async def list_documents(
    insurance_type: str = Query("", description="Filter by insurance type"),
    doc_type: str = Query("", description="Filter by doc_type: 'uploaded' or 'generated'"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    """List PDF metadata for the current user (admins see all)."""
    metadata = user.get("metadata", {})
    is_admin = metadata.get("role") == "admin"

    # Non-admin users can only see their own documents
    user_id_filter = "" if is_admin else user["user_id"]

    docs = await list_pdfs(
        user_id=user_id_filter,
        insurance_type=insurance_type,
        doc_type=doc_type,
        limit=limit,
        offset=offset,
    )

    # Serialize datetimes to ISO strings for JSON
    for doc in docs:
        if doc.get("created_at"):
            doc["created_at"] = doc["created_at"].isoformat()
        doc["id"] = str(doc["id"])

    return {"documents": docs}


@router.get("/{doc_id}")
async def download_document(
    doc_id: str,
    user: dict = Depends(get_current_user),
):
    """Download a stored PDF by its ID."""
    doc = await get_pdf(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # Non-admin users can only download their own documents
    metadata = user.get("metadata", {})
    is_admin = metadata.get("role") == "admin"
    if not is_admin and doc["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    return Response(
        content=doc["file_data"],
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{doc["file_name"]}"',
        },
    )


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: str,
    _admin: dict = Depends(require_admin),
):
    """Delete a stored PDF (admin only)."""
    deleted = await delete_pdf(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted"}
