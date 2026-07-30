"""When a media file came into existence, as opposed to when we indexed it.

`added_at` records the moment a row was inserted, which for a first scan means
the whole library shares one timestamp and "recently added" degrades to scan
order. What users mean by recently added is when the file appeared on disk, so
that is recorded separately.

Birth time is preferred and modification time is the fallback. Linux exposes
birth time through statx, but CPython does not surface it on Linux (st_birthtime
is macOS/BSD only), so it is read via coreutils `stat` and the result cached per
device -- filesystems either carry it or they do not, and probing a whole
library one file at a time would be wasted work.
"""

import logging
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# st_dev values already found to carry no birth time.
_no_btime_devices: set[int] = set()
_devices_lock = threading.Lock()


def _device_lacks_btime(device: int) -> bool:
    with _devices_lock:
        return device in _no_btime_devices


def _remember_device_lacks_btime(device: int) -> None:
    with _devices_lock:
        _no_btime_devices.add(device)


def _birth_time(path: str | Path, stat_result: os.stat_result) -> float | None:
    """Filesystem birth time in epoch seconds, or None where unavailable."""
    # Free on platforms where CPython exposes it; absent on Linux.
    native = getattr(stat_result, "st_birthtime", None)
    if native:
        return float(native)

    if _device_lacks_btime(stat_result.st_dev):
        return None

    try:
        result = subprocess.run(
            ["stat", "-c", "%W", str(path)],
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        # No usable `stat` binary. Treat the device as unsupported so the whole
        # library does not pay for a failing subprocess per file.
        _remember_device_lacks_btime(stat_result.st_dev)
        return None

    if result.returncode != 0:
        _remember_device_lacks_btime(stat_result.st_dev)
        return None

    raw = result.stdout.decode("utf-8", errors="replace").strip()
    try:
        value = float(raw)
    except ValueError:
        # Filesystems without birth time report "-" rather than a number.
        _remember_device_lacks_btime(stat_result.st_dev)
        return None

    if value <= 0:
        _remember_device_lacks_btime(stat_result.st_dev)
        return None
    return value


def file_created_at(path: str | Path) -> datetime | None:
    """Best available creation time for a file, or None if it cannot be read."""
    try:
        stat_result = os.stat(path)
    except OSError:
        return None

    timestamp = _birth_time(path, stat_result) or stat_result.st_mtime
    try:
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        # Nonsense timestamps do exist in the wild; better to sort by added_at
        # than to store a date from 1901.
        logger.warning("Unusable timestamp %s for %s", timestamp, path)
        return None
