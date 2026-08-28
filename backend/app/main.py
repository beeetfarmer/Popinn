import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import extract_access_token_from_request, get_user_from_access_token
from app.api.v1.router import router as v1_router
from app.core.config import settings
from app.core.database import async_session, get_db
from app.core.distributed_rate_limit import distributed_rate_limiter
from app.core.http_security import enforce_csrf_for_request
from app.core.logging_setup import configure_logging
from app.core.rate_limit import rate_limiter
from app.models.system import ScanJob, ScanStatus
from app.services.background_jobs import shutdown_background_jobs, submit_job
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_library_scan_interval_minutes,
    get_effective_media_path,
)
from app.tasks.scan import run_library_scan
from app.services.stream_tokens import validate_stream_token_for_resource

logger = logging.getLogger(__name__)


async def _recover_orphaned_scan_jobs() -> None:
    async with async_session() as db:
        result = await db.execute(
            select(ScanJob).where(ScanJob.status.in_([ScanStatus.pending, ScanStatus.running]))
        )
        jobs = result.scalars().all()
        if not jobs:
            return
        now = datetime.now(timezone.utc)
        for job in jobs:
            existing_errors: list[str] = []
            if job.errors:
                try:
                    parsed = json.loads(job.errors)
                    if isinstance(parsed, list):
                        existing_errors = [str(item) for item in parsed]
                except Exception:
                    existing_errors = [job.errors]
            existing_errors.append("Scan interrupted by backend restart")
            job.status = ScanStatus.failed
            job.completed_at = now
            job.current_folder = None
            job.errors = json.dumps(existing_errors)
        await db.commit()
        logger.warning("Recovered %s orphaned scan job(s) after startup", len(jobs))


async def _auto_scan_loop() -> None:
    # ponytail: single-process scheduler. Two backend replicas would each run
    # this loop; the "already active" check makes a double-scan unlikely but not
    # impossible under a race. Move to a DB advisory lock if you run replicas.
    poll_seconds = 60
    last_run = time.monotonic()  # wait one full interval before the first auto-scan
    while True:
        try:
            await asyncio.sleep(poll_seconds)
            async with async_session() as db:
                minutes = await get_effective_library_scan_interval_minutes(db)
                if minutes <= 0 or time.monotonic() - last_run < minutes * 60:
                    continue
                active = await db.scalar(
                    select(ScanJob).where(
                        ScanJob.status.in_([ScanStatus.pending, ScanStatus.running])
                    )
                )
                if active is not None:
                    continue
                job = ScanJob()
                db.add(job)
                await db.commit()
                await db.refresh(job)
            submit_job("scan", run_library_scan, str(job.id), cancel_key=str(job.id))
            last_run = time.monotonic()
            logger.info("Automatic library scan queued (every %s min)", minutes)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Automatic scan loop error; retrying next cycle")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    await _recover_orphaned_scan_jobs()
    auto_scan_task = asyncio.create_task(_auto_scan_loop())
    try:
        yield
    finally:
        auto_scan_task.cancel()
        shutdown_background_jobs(wait=False)


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)


async def _authorize_stream_or_user(
    request: Request,
    db: AsyncSession,
    *,
    resource_path: str,
    stream_token: str | None,
) -> None:
    if settings.STREAM_TOKENIZATION_ENABLED and stream_token:
        if await validate_stream_token_for_resource(stream_token, resource_path, db):
            return
        raise HTTPException(status_code=401, detail="Invalid or expired stream token")

    if settings.STREAM_TOKENIZATION_ENABLED and settings.STREAM_TOKEN_REQUIRED:
        raise HTTPException(status_code=401, detail="Missing stream token")

    access_token = extract_access_token_from_request(request)
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    user = await get_user_from_access_token(access_token, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def _enforce_rate_limit(
    *,
    bucket: str,
    identifier: str,
    limit: str,
) -> None:
    try:
        async with async_session() as db:
            await distributed_rate_limiter.check(
                db,
                bucket=bucket,
                identifier=identifier,
                limit=limit,
            )
    except HTTPException:
        raise
    except Exception:
        # If DB-backed limiting fails, fail closed to in-process limiter.
        logger.exception("Distributed rate limiting failed for bucket=%s; using local fallback", bucket)
        rate_limiter.check(bucket, identifier, limit)


@app.middleware("http")
async def request_context_and_security_headers(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    start = time.perf_counter()
    client_identifier = request.client.host if request.client else "unknown"
    method = request.method.upper()
    path = request.url.path

    # Endpoint-focused rate limits (auth + scan trigger).
    try:
        if path in {
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/refresh",
        }:
            await _enforce_rate_limit(
                bucket="auth",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_AUTH,
            )
        elif path in {"/api/v1/scan/run", "/api/v1/scan/artist-metadata/run"}:
            await _enforce_rate_limit(
                bucket="scan",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_SCAN,
            )
        elif path == "/api/v1/videos/spotify/search":
            await _enforce_rate_limit(
                bucket="spotify_search",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_SPOTIFY_SEARCH,
            )
        elif path == "/api/v1/artists/lastfm/search":
            await _enforce_rate_limit(
                bucket="lastfm_search",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_LASTFM_SEARCH,
            )
        elif method == "POST" and path.startswith("/api/v1/artists/") and path.endswith("/refresh-metadata"):
            await _enforce_rate_limit(
                bucket="artist_metadata_refresh",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_ARTIST_METADATA_REFRESH,
            )
        elif method == "POST" and path.startswith("/api/v1/videos/") and path.endswith("/plays"):
            await _enforce_rate_limit(
                bucket="video_play_event",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_PLAY_EVENT,
            )
        elif method == "POST" and path == "/api/v1/settings/import":
            await _enforce_rate_limit(
                bucket="settings_import",
                identifier=client_identifier,
                limit=settings.RATE_LIMIT_SETTINGS_IMPORT,
            )

        enforce_csrf_for_request(request)
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled error processing %s %s", request.method, request.url.path)
        raise
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Origin-Agent-Cluster"] = "?1"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    if settings.COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.include_router(v1_router, prefix=settings.API_V1_PREFIX)


def _asset_response(file_path: Path) -> Response:
    """Serve a generated asset with cache semantics that suit its type.

    Two problems this exists to avoid, both of which produce a video that plays
    from the middle with no seek bar:

    * FileResponse sets no Cache-Control, so browsers fall back to heuristic
      freshness off Last-Modified and will happily reuse a playlist for minutes
      without revalidating. A playlist cached while a transcode was broken then
      survives the fix -- the file on disk is correct and the player still sees
      a truncated one.
    * FileResponse advertises byte ranges. A ranged request for a playlist can
      return everything except the tail, and the tail is where #EXT-X-ENDLIST
      lives; without it the player treats a finished recording as a live stream.

    Playlists are therefore sent whole and never stored. Segments and images do
    get reused, but only after revalidating, because a re-transcode overwrites
    segment_000.ts and friends in place -- the names stay the same while the
    bytes change, so anything cached by name alone would go stale.
    """
    if file_path.suffix.lower() == ".m3u8":
        return Response(
            content=file_path.read_bytes(),
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store", "Accept-Ranges": "none"},
        )
    return FileResponse(file_path, headers={"Cache-Control": "no-cache"})


@app.get("/media/{requested_path:path}")
async def serve_media(
    requested_path: str,
    request: Request,
    st: str | None = Query(None, alias="st", max_length=4096),
):
    async with async_session() as db:
        await _authorize_stream_or_user(
            request,
            db,
            resource_path=f"/media/{requested_path}",
            stream_token=st,
        )
        media_root = Path(await get_effective_media_path(db)).resolve(strict=False)
        file_path = (media_root / requested_path).resolve(strict=False)
    try:
        file_path.relative_to(media_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


@app.get("/data/{requested_path:path}")
async def serve_app_data(
    requested_path: str,
    request: Request,
    st: str | None = Query(None, alias="st", max_length=4096),
):
    async with async_session() as db:
        await _authorize_stream_or_user(
            request,
            db,
            resource_path=f"/data/{requested_path}",
            stream_token=st,
        )
        request_parts = Path(requested_path).parts
        if not request_parts or request_parts[0] not in settings.app_data_public_subdirs:
            raise HTTPException(status_code=404, detail="File not found")

        app_data_root = Path(await get_effective_app_data_path(db)).resolve(strict=False)
        file_path = (app_data_root / requested_path).resolve(strict=False)
    try:
        file_path.relative_to(app_data_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return _asset_response(file_path)
