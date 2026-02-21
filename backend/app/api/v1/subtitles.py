import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    extract_access_token_from_request,
    get_current_user,
    get_user_from_access_token,
)
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.subtitle import Subtitle, SubtitleFormat
from app.models.video import Video
from app.schemas.subtitle import SubtitleRead
from app.services.runtime_settings import get_effective_media_path
from app.services.stream_tokens import sign_stream_url_for_user, validate_stream_token_for_resource

router = APIRouter(tags=["subtitles"])


def _subtitle_to_read(sub: Subtitle, user_id: uuid.UUID) -> SubtitleRead:
    subtitle_url = sign_stream_url_for_user(f"/api/v1/subtitles/{sub.id}/vtt", user_id)
    return SubtitleRead(
        id=sub.id,
        video_id=sub.video_id,
        language=sub.language,
        format=sub.format.value,
        url=subtitle_url,
    )


def _srt_to_vtt(srt_content: str) -> str:
    """Convert SRT subtitle content to WebVTT format."""
    vtt = "WEBVTT\n\n"
    # Replace comma with dot in timestamps (e.g., 00:01:23,456 -> 00:01:23.456)
    converted = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", srt_content)
    # Remove SRT sequence numbers (lines that are just a number before timestamps)
    converted = re.sub(r"^\d+\s*\n(?=\d{2}:\d{2}:\d{2})", "", converted, flags=re.MULTILINE)
    vtt += converted
    return vtt


@router.get("/videos/{video_id}/subtitles", response_model=list[SubtitleRead])
async def list_video_subtitles(
    video_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    video_exists = await db.scalar(
        select(Video.id).where(Video.id == video_id, Video.deleted_at.is_(None))
    )
    if not video_exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video not found",
        )

    result = await db.execute(
        select(Subtitle).where(Subtitle.video_id == video_id)
    )
    subs = result.scalars().all()
    return [_subtitle_to_read(s, _user.id) for s in subs]


@router.get("/subtitles/{subtitle_id}/vtt")
async def get_subtitle_vtt(
    subtitle_id: uuid.UUID,
    request: Request,
    st: str | None = Query(None, alias="st", max_length=4096),
    db: AsyncSession = Depends(get_db),
):
    resource_path = f"/api/v1/subtitles/{subtitle_id}/vtt"
    if settings.STREAM_TOKENIZATION_ENABLED and st:
        if not await validate_stream_token_for_resource(st, resource_path, db):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired stream token",
            )
    else:
        if settings.STREAM_TOKENIZATION_ENABLED and settings.STREAM_TOKEN_REQUIRED:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing stream token",
            )
        access_token = extract_access_token_from_request(request)
        if not access_token or await get_user_from_access_token(access_token, db) is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

    result = await db.execute(
        select(Subtitle)
        .join(Video, Video.id == Subtitle.video_id)
        .where(
            Subtitle.id == subtitle_id,
            Video.deleted_at.is_(None),
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle not found",
        )

    media_root = Path(await get_effective_media_path(db)).resolve(strict=False)
    subtitle_path = Path(sub.file_path).resolve(strict=False)
    try:
        subtitle_path.relative_to(media_root)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle file not found on disk",
        )
    if not subtitle_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle file not found on disk",
        )
    if subtitle_path.stat().st_size > settings.MAX_SUBTITLE_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Subtitle file is too large",
        )

    try:
        with open(subtitle_path, "r", encoding="utf-8-sig") as subtitle_file:
            content = subtitle_file.read()
    except (FileNotFoundError, OSError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle file not found on disk",
        )
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subtitle encoding is not supported",
        )

    if sub.format == SubtitleFormat.srt:
        content = _srt_to_vtt(content)

    return PlainTextResponse(content, media_type="text/vtt")
