from datetime import datetime, timezone
import random

from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token, exp_claim_to_datetime
from app.models.system import RevokedToken


def _extract_jti_and_exp(
    token: str,
    *,
    expected_type: str,
) -> tuple[str, datetime] | None:
    payload = decode_token(token)
    if payload is None or payload.get("type") != expected_type:
        return None

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti.strip():
        return None
    expires_at = exp_claim_to_datetime(payload.get("exp"))
    if expires_at is None:
        return None
    return jti.strip(), expires_at


async def revoke_token_if_present(
    token: str | None,
    *,
    expected_type: str,
    db: AsyncSession,
) -> bool:
    if not token:
        return False
    extracted = _extract_jti_and_exp(token, expected_type=expected_type)
    if extracted is None:
        return False
    jti, expires_at = extracted
    if expires_at <= datetime.now(timezone.utc):
        return False

    existing = await db.scalar(select(RevokedToken).where(RevokedToken.jti == jti))
    if existing is not None:
        return True

    if random.random() < 0.05:
        await db.execute(
            delete(RevokedToken).where(RevokedToken.expires_at < datetime.now(timezone.utc))
        )

    db.add(
        RevokedToken(
            jti=jti,
            token_type=expected_type,
            expires_at=expires_at,
        )
    )
    return True


async def is_token_payload_revoked(
    payload: dict,
    *,
    expected_type: str,
    db: AsyncSession,
) -> bool:
    if payload.get("type") != expected_type:
        return True

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti.strip():
        # Force re-login for pre-jti tokens instead of allowing non-revokable sessions.
        return True

    token = await db.scalar(select(RevokedToken).where(RevokedToken.jti == jti))
    if token is None:
        return False

    # Auto-ignore stale revocation rows if token is already expired.
    if token.expires_at <= datetime.now(timezone.utc):
        return False
    return True
