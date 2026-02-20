from collections import defaultdict, deque
import threading
import time

from fastapi import HTTPException, status


def _parse_limit(limit: str) -> tuple[int, int]:
    """Parse strings like '10/minute' -> (10, 60)."""
    amount_str, period = limit.split("/", 1)
    amount = int(amount_str.strip())
    period = period.strip().lower()
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


rate_limiter = InMemoryRateLimiter()
