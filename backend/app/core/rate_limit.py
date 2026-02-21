from collections import defaultdict, deque
import asyncio
import threading
import time

from fastapi import HTTPException, status


def _parse_limit(limit: str) -> tuple[int, int]:
    """Parse strings like '10/minute' -> (10, 60)."""
    amount_str, period = limit.split("/", 1)
    amount = int(amount_str.strip())
    period = period.strip().lower().rstrip("s")
    seconds_by_period = {
        "second": 1,
        "minute": 60,
        "hour": 3600,
    }
    if period not in seconds_by_period:
        raise ValueError(f"Unsupported rate limit period: {period}")
    return amount, seconds_by_period[period]


class InMemoryRateLimiter:
    def __init__(self):
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, bucket: str, identifier: str, limit: str) -> None:
        max_calls, period_seconds = _parse_limit(limit)
        now = time.time()
        key = f"{bucket}:{identifier}"

        with self._lock:
            q = self._hits[key]
            cutoff = now - period_seconds
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= max_calls:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit exceeded",
                )
            q.append(now)

    def _acquire_slot(self, bucket: str, identifier: str, limit: str) -> float:
        max_calls, period_seconds = _parse_limit(limit)
        now = time.time()
        key = f"{bucket}:{identifier}"

        with self._lock:
            q = self._hits[key]
            cutoff = now - period_seconds
            while q and q[0] < cutoff:
                q.popleft()

            if len(q) < max_calls:
                q.append(now)
                return 0.0

            wait_seconds = max(0.001, (q[0] + period_seconds) - now)
            return wait_seconds

    def wait(self, bucket: str, identifier: str, limit: str) -> None:
        while True:
            wait_seconds = self._acquire_slot(bucket, identifier, limit)
            if wait_seconds <= 0:
                return
            time.sleep(wait_seconds)

    async def async_wait(self, bucket: str, identifier: str, limit: str) -> None:
        while True:
            wait_seconds = self._acquire_slot(bucket, identifier, limit)
            if wait_seconds <= 0:
                return
            await asyncio.sleep(wait_seconds)


rate_limiter = InMemoryRateLimiter()
