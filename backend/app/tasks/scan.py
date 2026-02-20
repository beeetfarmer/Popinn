import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_sync_session_factory
from app.models.system import ScanJob, ScanStatus
from app.services.runtime_settings import (
    get_effective_media_path_sync,
)

logger = logging.getLogger(__name__)


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
        session.commit()

    try:
        with session_factory() as session:
            media_path = get_effective_media_path_sync(session)

        result = run_scan(
            session_factory=session_factory,
            media_path=media_path,
            lastfm_api_key=settings.LASTFM_API_KEY,
            thumbnail_dir=settings.THUMBNAIL_DIR,
        )

        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            job.status = ScanStatus.completed
            job.completed_at = datetime.now(timezone.utc)
            job.files_found = result.files_found
            job.files_added = result.files_added
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
                job.errors = json.dumps([str(e)])
                session.commit()
        return {"status": "failed", "error": str(e)}
