import json
import logging
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.system import ScanJob
from app.models.system import ScanStatus
from app.models.user import User
from app.schemas.scan import ScanJobRead, ScanTriggerResponse
from app.services.background_jobs import request_cancel, submit_job
from app.tasks.scan import (
    run_artist_metadata_refresh_scan,
    run_library_scan,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/run", response_model=ScanTriggerResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_scan_direct(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a library scan in a background worker thread."""
    _ = admin
    job = ScanJob()
    db.add(job)
    await db.commit()
    await db.refresh(job)

    submit_job("scan", run_library_scan, str(job.id), cancel_key=str(job.id))

    return ScanTriggerResponse(
        job_id=job.id,
        message="Scan queued",
    )


@router.post("/artist-metadata/run", response_model=ScanTriggerResponse, status_code=status.HTTP_202_ACCEPTED)
async def run_artist_metadata_scan(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Trigger artist bio/image metadata refresh from Last.fm."""
    _ = admin
    job = ScanJob()
    db.add(job)
    await db.commit()
    await db.refresh(job)

    submit_job(
        "artist-metadata-scan",
        run_artist_metadata_refresh_scan,
        str(job.id),
        cancel_key=str(job.id),
    )

    return ScanTriggerResponse(
        job_id=job.id,
        message="Artist metadata refresh queued",
    )


@router.get("/jobs", response_model=list[ScanJobRead])
async def list_scan_jobs(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all scan jobs, most recent first."""
    _ = admin
    result = await db.execute(select(ScanJob).order_by(ScanJob.started_at.desc().nulls_last()))
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=ScanJobRead)
async def get_scan_job(
    job_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific scan job by ID."""
    _ = admin
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan job not found",
        )
    return job


@router.post("/jobs/{job_id}/cancel", response_model=ScanTriggerResponse)
async def cancel_scan_job(
    job_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Request cancellation for a running/pending scan job."""
    _ = admin
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan job not found",
        )
    if job.status in {"completed", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Scan job is already finished",
        )
    if not request_cancel(str(job_id)):
        # If backend restarted, the in-memory worker/cancel token is gone but the DB job may
        # still be marked running. Recover it here so the UI doesn't stay stuck forever.
        job.status = ScanStatus.failed
        job.completed_at = datetime.now(timezone.utc)
        job.current_folder = None
        existing_errors: list[str] = []
        if job.errors:
            try:
                parsed = json.loads(job.errors)
                if isinstance(parsed, list):
                    existing_errors = [str(item) for item in parsed]
            except Exception:
                existing_errors = [job.errors]
        existing_errors.append("Scan cancelled after backend restart (orphaned job recovered)")
        job.errors = json.dumps(existing_errors)
        await db.commit()
        return ScanTriggerResponse(job_id=job_id, message="Orphaned scan job recovered and cancelled")
    return ScanTriggerResponse(job_id=job_id, message="Cancel requested")
