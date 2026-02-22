import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import ALGORITHM, decode_token
from app.models.user import User

STREAM_TOKEN_QUERY_PARAM = "st"
_STREAM_PATH_PREFIXES = ("/media/", "/data/", "/api/v1/subtitles/")


def _normalize_resource_path(value: str) -> str:
    path = urlsplit(value).path.strip()
    if not path.startswith("/"):
        path = f"/{path}"
    return path


def _is_stream_resource_path(path: str) -> bool:
    return path.startswith(_STREAM_PATH_PREFIXES)


def create_stream_token(user_id: uuid.UUID, resource_path: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=max(60, int(settings.STREAM_TOKEN_TTL_SECONDS))
    )
    payload = {
        "sub": str(user_id),
        "type": "stream",
        "resource": _normalize_resource_path(resource_path),
        "jti": str(uuid.uuid4()),
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def sign_stream_url_for_user(url: str | None, user_id: uuid.UUID) -> str | None:
    if not url:
        return url
    if not settings.STREAM_TOKENIZATION_ENABLED:
        return url

    parts = urlsplit(url)
    resource_path = _normalize_resource_path(parts.path)
    if not _is_stream_resource_path(resource_path):
        return url

    token = create_stream_token(user_id, resource_path)
    existing_query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != STREAM_TOKEN_QUERY_PARAM]
    existing_query.append((STREAM_TOKEN_QUERY_PARAM, token))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(existing_query), parts.fragment))


async def validate_stream_token_for_resource(
    token: str,
    resource_path: str,
    db: AsyncSession,
) -> bool:
    payload = decode_token(token)
    if payload is None or payload.get("type") != "stream":
        return False

    token_resource = payload.get("resource")
    if not isinstance(token_resource, str):
        return False
    if _normalize_resource_path(token_resource) != _normalize_resource_path(resource_path):
        return False

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError):
        return False

    user_exists = await db.scalar(
        select(User.id).where(
            User.id == user_id,
            User.is_active.is_(True),
        )
    )
    return user_exists is not None
