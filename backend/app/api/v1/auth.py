import uuid
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.http_security import clear_auth_cookies, set_auth_cookies
from app.core.uploads import read_upload_limited
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.artist import Artist
from app.models.playback import VideoPlay
from app.models.user import User, UserRole
from app.models.video import Video
from app.schemas.auth import (
    TokenPair,
    TokenRefresh,
    UserPlaybackRead,
    UserLogin,
    UserRead,
    UserRegister,
    UserUpdate,
)
from app.services.path_urls import to_public_asset_url
from app.services.runtime_settings import get_effective_app_data_path, get_effective_media_path
from app.services.stream_tokens import sign_stream_url_for_user
from app.services.token_revocation import (
    is_token_payload_revoked,
    revoke_token_if_present,
)

router = APIRouter(prefix="/auth", tags=["auth"])
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _issue_tokens_for_user(response: Response, user: User) -> TokenPair:
    access_token = create_access_token(user.id, user.role.value)
    refresh_token = create_refresh_token(user.id)
    set_auth_cookies(response, access_token, refresh_token)
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
    )


def _asset_url(
    abs_path_or_url: str | None,
    media_root: str,
    app_data_root: str,
    cache_bust: bool = False,
    user_id: uuid.UUID | None = None,
) -> str | None:
    signer = None
    if user_id is not None:
        signer = lambda url: sign_stream_url_for_user(url, user_id) or url
    return to_public_asset_url(
        abs_path_or_url,
        media_root=media_root,
        app_data_root=app_data_root,
        cache_bust=cache_bust,
        signer=signer,
    )


def _user_to_read(user: User, media_root: str, app_data_root: str) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        image_url=_asset_url(
            user.image_path,
            media_root,
            app_data_root,
            cache_bust=True,
            user_id=user.id,
        ),
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    response: Response,
    data: UserRegister,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(or_(User.username == data.username, User.email == data.email))
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already registered",
        )

    # First user becomes admin automatically
    count_result = await db.execute(select(func.count(User.id)))
    user_count = count_result.scalar() or 0
    if user_count > 0 and not settings.ALLOW_PUBLIC_REGISTRATION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled",
        )
    role = UserRole.admin if user_count == 0 else UserRole.user

    user = User(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    _issue_tokens_for_user(response, user)
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    return _user_to_read(user, media_root, app_data_root)


@router.post("/login", response_model=TokenPair)
async def login(
    response: Response,
    data: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    return _issue_tokens_for_user(response, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    request: Request,
    response: Response,
    data: TokenRefresh | None = None,
    db: AsyncSession = Depends(get_db),
):
    refresh_token = None
    if data:
        refresh_token = data.refresh_token
    if not refresh_token:
        refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    payload = decode_token(refresh_token)

    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    if await is_token_payload_revoked(payload, expected_type="refresh", db=db):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is no longer valid. Please sign in again.",
        )

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Rotate refresh token to prevent replay.
    await revoke_token_if_present(
        refresh_token,
        expected_type="refresh",
        db=db,
    )
    await db.commit()

    return _issue_tokens_for_user(response, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    header_access_token: str | None = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        header_access_token = auth_header[7:].strip() or None

    access_token = header_access_token or request.cookies.get(settings.ACCESS_COOKIE_NAME)
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)

    await revoke_token_if_present(
        access_token,
        expected_type="access",
        db=db,
    )
    await revoke_token_if_present(
        refresh_token,
        expected_type="refresh",
        db=db,
    )
    await db.commit()
    clear_auth_cookies(response)


@router.get("/me", response_model=UserRead)
async def get_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    return _user_to_read(user, media_root, app_data_root)


@router.patch("/me", response_model=UserRead)
async def update_me(
    data: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if data.username and data.username != user.username:
        existing = await db.execute(
            select(User).where(User.username == data.username, User.id != user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already taken",
            )
        user.username = data.username

    if data.email and data.email != user.email:
        existing = await db.execute(
            select(User).where(User.email == data.email, User.id != user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already taken",
            )
        user.email = data.email

    if data.new_password:
        user.hashed_password = hash_password(data.new_password)

    await db.commit()
    await db.refresh(user)
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    return _user_to_read(user, media_root, app_data_root)


@router.put("/me/image", response_model=UserRead)
async def upload_my_image(
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image",
        )

    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    ext = (os.path.splitext(file.filename or "img.jpg")[1] or ".jpg").lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        ext = ".jpg"
    image_dir = os.path.join(app_data_root, ".user-images")
    os.makedirs(image_dir, exist_ok=True)
    image_path = os.path.join(image_dir, f"{user.id}{ext}")

    content = await read_upload_limited(
        file,
        settings.MAX_IMAGE_UPLOAD_BYTES,
        "Image file is too large",
    )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file is empty",
        )
    with open(image_path, "wb") as f:
        f.write(content)

    user.image_path = image_path
    await db.commit()
    await db.refresh(user)
    return _user_to_read(user, media_root, app_data_root)


@router.get("/me/plays", response_model=list[UserPlaybackRead])
async def list_my_playback_history(
    title: str | None = Query(None, description="Filter by video title"),
    artist_id: uuid.UUID | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            VideoPlay,
            Video.id.label("video_id"),
            Video.title.label("video_title"),
            Artist.id.label("artist_id"),
            Artist.name.label("artist_name"),
        )
        .join(Video, VideoPlay.video_id == Video.id)
        .join(Artist, Video.artist_id == Artist.id)
        .where(
            VideoPlay.user_id == user.id,
            Video.deleted_at.is_(None),
            Artist.deleted_at.is_(None),
        )
        .order_by(VideoPlay.played_at.desc())
        .limit(limit)
    )

    if title:
        query = query.where(Video.title.ilike(f"%{title}%"))
    if artist_id:
        query = query.where(Video.artist_id == artist_id)

    rows = (await db.execute(query)).all()
    return [
        UserPlaybackRead(
            id=play.id,
            video_id=video_id,
            video_title=video_title,
            artist_id=row_artist_id,
            artist_name=artist_name,
            watched_seconds=play.watched_seconds,
            counted_play=play.counted_play,
            played_at=play.played_at,
        )
        for play, video_id, video_title, row_artist_id, artist_name in rows
    ]


@router.get("/users", response_model=list[UserRead])
async def list_users(
    _admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    media_root = await get_effective_media_path(db)
    app_data_root = await get_effective_app_data_path(db)
    users = result.scalars().all()
    return [_user_to_read(user, media_root, app_data_root) for user in users]


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    await db.delete(user)
    await db.commit()
