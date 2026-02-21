from contextlib import asynccontextmanager
import logging
from pathlib import Path
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.router import router as v1_router
from app.core.config import settings
from app.core.database import get_db
from app.core.http_security import enforce_csrf_for_request
from app.core.logging_setup import configure_logging
from app.core.rate_limit import rate_limiter
from app.services.background_jobs import shutdown_background_jobs
from app.services.runtime_settings import (
    get_effective_app_data_path,
    get_effective_media_path,
)

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
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_and_security_headers(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    start = time.perf_counter()

    # Endpoint-focused rate limits (auth + scan trigger).
    try:
        if request.url.path in {
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/refresh",
        }:
            rate_limiter.check("auth", request.client.host if request.client else "unknown", settings.RATE_LIMIT_AUTH)
        elif request.url.path == "/api/v1/scan/run":
            rate_limiter.check("scan", request.client.host if request.client else "unknown", settings.RATE_LIMIT_SCAN)
        elif request.url.path == "/api/v1/videos/spotify/search":
            rate_limiter.check(
                "spotify_search",
                request.client.host if request.client else "unknown",
                settings.RATE_LIMIT_SPOTIFY_SEARCH,
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
    if settings.COOKIE_SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.include_router(v1_router, prefix=settings.API_V1_PREFIX)


@app.get("/media/{requested_path:path}")
async def serve_media(
    requested_path: str,
    db: AsyncSession = Depends(get_db),
):
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
    db: AsyncSession = Depends(get_db),
):
    app_data_root = Path(await get_effective_app_data_path(db)).resolve(strict=False)
    file_path = (app_data_root / requested_path).resolve(strict=False)
    try:
        file_path.relative_to(app_data_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)
