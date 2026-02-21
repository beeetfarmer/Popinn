import random
import time

from fastapi import HTTPException, status
from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import _parse_limit
from app.models.system import RateLimitCounter


class DistributedRateLimiter:
    async def check(
        self,
        db: AsyncSession,
        *,
        bucket: str,
        identifier: str,
        limit: str,
    ) -> None:
        max_calls, period_seconds = _parse_limit(limit)
        now = time.time()
        window_start = int(now // period_seconds) * period_seconds

        stmt = (
            insert(RateLimitCounter)
            .values(
                bucket=bucket,
                identifier=identifier,
                window_start=window_start,
                count=1,
            )
            .on_conflict_do_update(
                index_elements=[
                    RateLimitCounter.bucket,
                    RateLimitCounter.identifier,
                    RateLimitCounter.window_start,
                ],
                set_={
                    "count": RateLimitCounter.count + 1,
                    "updated_at": func.now(),
                },
            )
            .returning(RateLimitCounter.count)
        )
        count = (await db.execute(stmt)).scalar_one()

        # Opportunistic cleanup keeps table small in long-running deployments.
        if random.random() < 0.01:
            stale_cutoff = int((now - (period_seconds * 10)) // period_seconds) * period_seconds
            await db.execute(
                delete(RateLimitCounter).where(RateLimitCounter.window_start < stale_cutoff)
            )

        await db.commit()

        if int(count) > max_calls:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded",
            )


distributed_rate_limiter = DistributedRateLimiter()
