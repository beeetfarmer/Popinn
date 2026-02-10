import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.subtitle import Subtitle, SubtitleFormat
from app.schemas.subtitle import SubtitleRead

router = APIRouter(tags=["subtitles"])


def _to_media_url(abs_path: str | None) -> str | None:
    if not abs_path:
        return None
    media = settings.MEDIA_PATH.rstrip("/")
    if abs_path.startswith(media):
        return "/media" + abs_path[len(media):]
    return None


def _subtitle_to_read(sub: Subtitle) -> SubtitleRead:
    return SubtitleRead(
        id=sub.id,
        video_id=sub.video_id,
        language=sub.language,
        format=sub.format.value,
        url=f"/api/v1/subtitles/{sub.id}/vtt",
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
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subtitle).where(Subtitle.video_id == video_id)
    )
    subs = result.scalars().all()
    return [_subtitle_to_read(s) for s in subs]


@router.get("/subtitles/{subtitle_id}/vtt")
async def get_subtitle_vtt(
    subtitle_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subtitle).where(Subtitle.id == subtitle_id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle not found",
        )

    try:
        content = open(sub.file_path, "r", encoding="utf-8-sig").read()
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subtitle file not found on disk",
        )

    if sub.format == SubtitleFormat.srt:
        content = _srt_to_vtt(content)

    return PlainTextResponse(content, media_type="text/vtt")
