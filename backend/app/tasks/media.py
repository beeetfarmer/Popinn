import logging
import os

from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_sync_session_factory
from app.models.video import Video
from app.services.metadata import (
    HlsCancelled,
    generate_hls,
    generate_thumbnail,
    playlist_is_complete,
)
from app.services.runtime_settings import (
    get_effective_app_data_path_sync,
)
from app.services.transcode_status import get_run, needs_transcode

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


def pending_transcode_videos(session) -> list[Video]:
    """Active videos that need an HLS rendition but do not have a usable one.

    "Usable" means a *complete* playlist -- a truncated one from a killed
    transcode is treated as missing so it gets regenerated rather than served.
    """
    app_data_path = get_effective_app_data_path_sync(session)
    videos = session.execute(
        select(Video).where(Video.deleted_at.is_(None))
    ).scalars().all()

    pending = []
    for video in videos:
        if not needs_transcode(video.file_path):
            continue
        playlist = os.path.join(
            app_data_path, settings.HLS_DIR, str(video.id), "index.m3u8"
        )
        if not playlist_is_complete(playlist):
            pending.append(video)
    return pending


def transcode_one_and_report(video_id: str, title: str) -> dict:
    """Run one transcode as part of a bulk run, reporting into the run state."""
    run = get_run()

    # Everything still queued when a cancel arrives ends here. The pool cannot
    # un-queue work, so jobs drop themselves instead -- which is fast enough
    # that a cancelled run of hundreds closes almost immediately.
    if run.is_cancelling():
        run.record(False, was_cancelled=True)
        return {"status": "cancelled"}

    run.set_current(title)
    try:
        result = generate_hls_for_video(video_id, should_cancel=run.is_cancelling)
        run.record(result.get("status") == "completed")
        return result
    except HlsCancelled:
        # The encode that was actually running when cancel was pressed. Its
        # partial output has already been discarded, so the video is back to
        # counting as untranscoded.
        run.record(False, was_cancelled=True)
        return {"status": "cancelled"}
    except Exception:
        # A crashing job must still report, or the run never reaches its total
        # and the UI shows a progress bar that never completes.
        run.record(False)
        raise


def generate_hls_for_video(
    video_id: str,
    should_cancel=None,
) -> dict:
    session_factory = get_sync_session_factory()
    with session_factory() as session:
        video = session.get(Video, video_id)
        if not video:
            return {"status": "failed", "error": "Video not found"}
        if not os.path.exists(video.file_path):
            return {"status": "failed", "error": "Video file missing"}

        app_data_path = get_effective_app_data_path_sync(session)
        hls_dir = os.path.join(app_data_path, settings.HLS_DIR, str(video.id))
        playlist = generate_hls(video.file_path, hls_dir, should_cancel=should_cancel)
        if not playlist:
            return {"status": "failed", "error": "HLS generation failed"}
        return {"status": "completed", "playlist": playlist}
