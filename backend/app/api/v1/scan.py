import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin
from app.core.database import get_db
from app.models.system import ScanJob
from app.models.user import User
from app.schemas.scan import ScanJobRead, ScanTriggerResponse
from app.services.background_jobs import submit_job
from app.tasks.scan import run_library_scan

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

    submit_job("scan", run_library_scan, str(job.id))

    return ScanTriggerResponse(
        job_id=job.id,
        message="Scan queued",
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
