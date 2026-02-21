import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_sync_session_factory
from app.models.system import ScanJob, ScanStatus
from app.services.runtime_settings import (
    get_effective_app_data_path_sync,
    get_effective_lastfm_override_local_artist_images_sync,
    get_effective_media_path_sync,
)

logger = logging.getLogger(__name__)


def _update_scan_job_progress(
    scan_job_id: str,
    session_factory,
    *,
    folders_total: int,
    folders_processed: int,
    current_folder: str | None,
    files_found: int,
    files_added: int,
) -> None:
    with session_factory() as session:
        job = session.get(ScanJob, scan_job_id)
        if not job:
            return
        job.folders_total = folders_total
        job.folders_processed = folders_processed
        job.current_folder = current_folder
        job.files_found = files_found
        job.files_added = files_added
        session.commit()


def run_library_scan(scan_job_id: str) -> dict:
    """Run a full library scan in-process."""
    from app.services.scanner import run_scan

    session_factory = get_sync_session_factory()

    with session_factory() as session:
        job = session.get(ScanJob, scan_job_id)
        if not job:
            logger.error("ScanJob %s not found", scan_job_id)
            return {"error": "ScanJob not found"}

        job.status = ScanStatus.running
        job.started_at = datetime.now(timezone.utc)
        job.completed_at = None
        job.files_found = 0
        job.files_added = 0
        job.folders_total = 0
        job.folders_processed = 0
        job.current_folder = None
        job.errors = None
        session.commit()

    try:
        with session_factory() as session:
            media_path = get_effective_media_path_sync(session)
            app_data_path = get_effective_app_data_path_sync(session)
            override_local_artist_images = get_effective_lastfm_override_local_artist_images_sync(
                session
            )

        def progress_callback(
            folders_total: int,
            folders_processed: int,
            current_folder: str | None,
            files_found: int,
            files_added: int,
        ) -> None:
            _update_scan_job_progress(
                scan_job_id,
                session_factory,
                folders_total=folders_total,
                folders_processed=folders_processed,
                current_folder=current_folder,
                files_found=files_found,
                files_added=files_added,
            )

        result = run_scan(
            session_factory=session_factory,
            media_path=media_path,
            app_data_path=app_data_path,
            lastfm_api_key=settings.LASTFM_API_KEY,
            lastfm_cache_ttl_hours=settings.LASTFM_CACHE_TTL_HOURS,
            thumbnail_dir=settings.THUMBNAIL_DIR,
            preview_dir=settings.PREVIEW_DIR,
            override_local_artist_images=override_local_artist_images,
            progress_callback=progress_callback,
        )

        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            job.status = ScanStatus.completed
            job.completed_at = datetime.now(timezone.utc)
            job.files_found = result.files_found
            job.files_added = result.files_added
            if job.folders_total is None:
                job.folders_total = 0
            job.folders_processed = job.folders_total
            job.current_folder = None
            job.errors = json.dumps(result.errors) if result.errors else None
            session.commit()

        return {
            "status": "completed",
            "files_found": result.files_found,
            "files_added": result.files_added,
        }
    except Exception as e:
        logger.exception("Scan task failed")
        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            if job:
                job.status = ScanStatus.failed
                job.completed_at = datetime.now(timezone.utc)
                job.current_folder = None
                job.errors = json.dumps([str(e)])
                session.commit()
        return {"status": "failed", "error": str(e)}


def run_artist_metadata_refresh_scan(scan_job_id: str) -> dict:
    """Refresh artist bio/image metadata for all artists in-process."""
    from app.services.scanner import refresh_artist_metadata

    session_factory = get_sync_session_factory()

    with session_factory() as session:
        job = session.get(ScanJob, scan_job_id)
        if not job:
            logger.error("ScanJob %s not found", scan_job_id)
            return {"error": "ScanJob not found"}

        job.status = ScanStatus.running
        job.started_at = datetime.now(timezone.utc)
        job.completed_at = None
        job.files_found = 0
        job.files_added = 0
        job.folders_total = 0
        job.folders_processed = 0
        job.current_folder = None
        job.errors = None
        session.commit()

    try:
        with session_factory() as session:
            override_local_artist_images = get_effective_lastfm_override_local_artist_images_sync(
                session
            )

        def progress_callback(
            folders_total: int,
            folders_processed: int,
            current_folder: str | None,
            files_found: int,
            files_added: int,
        ) -> None:
            _update_scan_job_progress(
                scan_job_id,
                session_factory,
                folders_total=folders_total,
                folders_processed=folders_processed,
                current_folder=current_folder,
                files_found=files_found,
                files_added=files_added,
            )

        result = refresh_artist_metadata(
            session_factory=session_factory,
            lastfm_api_key=settings.LASTFM_API_KEY,
            override_local_artist_images=override_local_artist_images,
            progress_callback=progress_callback,
        )

        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            job.status = ScanStatus.completed
            job.completed_at = datetime.now(timezone.utc)
            job.files_found = result.files_found
            job.files_added = result.files_added
            if job.folders_total is None:
                job.folders_total = 0
            job.folders_processed = job.folders_total
            job.current_folder = None
            job.errors = json.dumps(result.errors) if result.errors else None
            session.commit()

        return {
            "status": "completed",
            "artists_processed": result.files_found,
            "artists_updated": result.files_added,
        }
    except Exception as e:
        logger.exception("Artist metadata refresh task failed")
        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            if job:
                job.status = ScanStatus.failed
                job.completed_at = datetime.now(timezone.utc)
                job.current_folder = None
                job.errors = json.dumps([str(e)])
                session.commit()
        return {"status": "failed", "error": str(e)}
