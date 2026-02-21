import logging
import os

from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_sync_session_factory
from app.models.video import Video
from app.services.metadata import generate_hls, generate_thumbnail
from app.services.runtime_settings import (
    get_effective_app_data_path_sync,
)

logger = logging.getLogger(__name__)


def regenerate_all_thumbnails() -> dict:
    session_factory = get_sync_session_factory()
    regenerated = 0
    failed = 0
    with session_factory() as session:
        app_data_path = get_effective_app_data_path_sync(session)
        thumbnail_dir = os.path.join(app_data_path, settings.THUMBNAIL_DIR)
        os.makedirs(thumbnail_dir, exist_ok=True)

        videos = session.execute(
            select(Video).where(Video.deleted_at.is_(None))
        ).scalars().all()

        for video in videos:
            if not os.path.exists(video.file_path):
                failed += 1
                continue
            output_path = os.path.join(thumbnail_dir, f"{video.id}.jpg")
            if generate_thumbnail(video.file_path, output_path):
                video.thumbnail_path = output_path
                regenerated += 1
            else:
                failed += 1
        session.commit()

    return {"status": "completed", "regenerated": regenerated, "failed": failed}


def generate_hls_for_video(video_id: str) -> dict:
    session_factory = get_sync_session_factory()
    with session_factory() as session:
        video = session.get(Video, video_id)
        if not video:
            return {"status": "failed", "error": "Video not found"}
        if not os.path.exists(video.file_path):
            return {"status": "failed", "error": "Video file missing"}

        app_data_path = get_effective_app_data_path_sync(session)
        hls_dir = os.path.join(app_data_path, settings.HLS_DIR, str(video.id))
        playlist = generate_hls(video.file_path, hls_dir)
        if not playlist:
            return {"status": "failed", "error": "HLS generation failed"}
        return {"status": "completed", "playlist": playlist}
