from fastapi import HTTPException, UploadFile, status


async def read_upload_limited(file: UploadFile, max_bytes: int, detail: str) -> bytes:
    """Read an upload with a hard size ceiling to avoid memory abuse."""
    payload = await file.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=detail,
        )
    return payload
