from contextlib import asynccontextmanager
import logging
from pathlib import Path
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import extract_access_token_from_request, get_user_from_access_token
from app.api.v1.router import router as v1_router
from app.core.config import settings
from app.core.database import async_session, get_db
from app.core.distributed_rate_limit import distributed_rate_limiter
from app.core.http_security import enforce_csrf_for_request
from app.core.logging_setup import configure_logging
from app.core.rate_limit import rate_limiter
from app.services.background_jobs import shutdown_background_jobs
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_media_path,
)
from app.services.stream_tokens import validate_stream_token_for_resource

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    try:
        yield
    finally:
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


@app.get("/media/{requested_path:path}")
async def serve_media(
    requested_path: str,
    request: Request,
    st: str | None = Query(None, alias="st", max_length=4096),
    db: AsyncSession = Depends(get_db),
):
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
    db: AsyncSession = Depends(get_db),
):
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
    return FileResponse(file_path)
