"""Tracking for bulk HLS transcode runs.

Progress is deliberately split in two. How much of the library is transcoded is
derived from disk on every request -- it needs no bookkeeping and cannot drift
if a run is interrupted or the process restarts. Only the state of an
*in-flight* run is held in memory, because there is nowhere else for it to live:
the background pool is fire-and-forget and keeps no job records.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import threading

# Containers browsers generally cannot play directly, so they need an HLS
# rendition. .mp4 and .webm are left out: they play natively, and transcoding
# them would burn CPU to produce a worse copy.
NEEDS_TRANSCODE_EXTENSIONS = {".mkv", ".avi", ".mov"}


def needs_transcode(file_path: str) -> bool:
    """Whether this source requires an HLS rendition to be playable."""
    return Path(file_path).suffix.lower() in NEEDS_TRANSCODE_EXTENSIONS


@dataclass
class TranscodeRun:
    active: bool = False
    total: int = 0
    completed: int = 0
    failed: int = 0
    cancelled: int = 0
    cancelling: bool = False
    started_at: datetime | None = None
    finished_at: datetime | None = None
    current: str | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def start(self, total: int) -> bool:
        """Begin a run. Returns False if one is already in flight."""
        with self._lock:
            if self.active:
                return False
            self.active = True
            self.total = total
            self.completed = 0
            self.failed = 0
            self.cancelled = 0
            self.cancelling = False
            self.current = None
            self.started_at = datetime.now(timezone.utc)
            self.finished_at = None
            return True

    def set_current(self, title: str | None) -> None:
        with self._lock:
            self.current = title

    def request_cancel(self) -> bool:
        """Ask the run to stop. Returns False if nothing is in flight.

        Jobs already queued check this and return immediately; the encode that is
        actually running polls it and kills its ffmpeg. The run is not closed
        here -- every job still reports, so the final counts stay truthful, and
        short-circuited jobs drain almost instantly.
        """
        with self._lock:
            if not self.active:
                return False
            self.cancelling = True
            return True

    def is_cancelling(self) -> bool:
        with self._lock:
            return self.cancelling

    def record(self, ok: bool, *, was_cancelled: bool = False) -> None:
        """Record one finished job, closing the run once all have reported."""
        with self._lock:
            if was_cancelled:
                self.cancelled += 1
            elif ok:
                self.completed += 1
            else:
                self.failed += 1
            if self.completed + self.failed + self.cancelled >= self.total:
                self.active = False
                self.cancelling = False
                self.current = None
                self.finished_at = datetime.now(timezone.utc)

    def abandon(self) -> None:
        """Close out a run that could not be queued."""
        with self._lock:
            self.active = False
            self.cancelling = False
            self.current = None
            self.finished_at = datetime.now(timezone.utc)

    def snapshot(self) -> dict:
        with self._lock:
            processed = self.completed + self.failed + self.cancelled
            return {
                "active": self.active,
                "cancelling": self.cancelling,
                "total": self.total,
                "completed": self.completed,
                "failed": self.failed,
                "cancelled": self.cancelled,
                "processed": processed,
                "current": self.current,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
            }


_run = TranscodeRun()


def get_run() -> TranscodeRun:
    return _run
