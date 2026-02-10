import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.config import settings
from app.core.database import get_db, get_sync_session_factory
from app.models.system import ScanJob, ScanStatus
from app.models.user import User
from app.schemas.scan import ScanJobRead, ScanTriggerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scan", tags=["scan"])


def _run_scan_sync(scan_job_id: str) -> None:
    """Run scan synchronously (for use in thread pool, no Celery needed)."""
    from app.services.scanner import run_scan

    session_factory = get_sync_session_factory()

    with session_factory() as session:
        job = session.get(ScanJob, scan_job_id)
        if not job:
            return
        job.status = ScanStatus.running
        job.started_at = datetime.now(timezone.utc)
        session.commit()

    try:
        result = run_scan(
            session_factory=session_factory,
            media_path=settings.MEDIA_PATH,
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
    except Exception as e:
        logger.exception("Scan failed")
        with session_factory() as session:
            job = session.get(ScanJob, scan_job_id)
            if job:
                job.status = ScanStatus.failed
                job.completed_at = datetime.now(timezone.utc)
                job.errors = json.dumps([str(e)])
                session.commit()


@router.post("/run", response_model=ScanTriggerResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_scan_direct(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a library scan directly (no Celery). Runs in a background thread."""
    job = ScanJob()
    db.add(job)
    await db.commit()
    await db.refresh(job)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_scan_sync, str(job.id))

    return ScanTriggerResponse(
        job_id=job.id,
        message="Scan started",
    )


@router.get("/jobs", response_model=list[ScanJobRead])
async def list_scan_jobs(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all scan jobs, most recent first."""
    result = await db.execute(
        select(ScanJob).order_by(ScanJob.started_at.desc().nulls_last())
    )
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=ScanJobRead)
async def get_scan_job(
    job_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific scan job by ID."""
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan job not found",
        )
    return job
