from fastapi import APIRouter

from app.api.v1.artists import router as artists_router
from app.api.v1.auth import router as auth_router
from app.api.v1.scan import router as scan_router
from app.api.v1.settings import router as settings_router
from app.api.v1.subtitles import router as subtitles_router
from app.api.v1.videos import router as videos_router
from app.api.v1.watchlists import router as watchlists_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(scan_router)
router.include_router(artists_router)
router.include_router(videos_router)
router.include_router(watchlists_router)
router.include_router(settings_router)
router.include_router(subtitles_router)


@router.get("/health")
async def health_check():
    return {"status": "ok"}
