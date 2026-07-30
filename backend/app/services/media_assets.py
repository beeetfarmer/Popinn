"""Removal of the files Popinn generates for a video.

Deletion is soft: the row stays so the scanner can tell a video it has already
seen from a new one. The generated artefacts have no such reason to survive, and
an HLS rendition is by far the largest thing on disk -- leaving them behind is
what turns a replaced or deleted video into permanently orphaned gigabytes.
"""

import logging
import shutil
import uuid
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


def video_asset_paths(
    video_id: uuid.UUID | str,
    thumbnail_path: str | None,
    preview_path: str | None,
    app_data_root: str | Path,
) -> list[Path]:
    """Generated files belonging to one video, restricted to the app data root.

    The stored thumbnail and preview paths are absolute and could in principle
    point anywhere, so they are filtered rather than trusted. The HLS directory
    is derived rather than stored, so it is always in the expected place.
    """
    root = Path(app_data_root)
    candidates = [Path(p) for p in (thumbnail_path, preview_path) if p]
    candidates.append(root / settings.HLS_DIR / str(video_id))
    return [path for path in candidates if _within(path, root)]


def delete_video_assets(
    video_id: uuid.UUID | str,
    thumbnail_path: str | None,
    preview_path: str | None,
    app_data_root: str | Path,
) -> int:
    """Delete a video's thumbnail, preview and HLS output. Returns files removed.

    Never raises: cleanup runs alongside a delete that has already been agreed
    to, and a permissions problem on one stale file should not fail the request.
    """
    removed = 0
    for path in video_asset_paths(video_id, thumbnail_path, preview_path, app_data_root):
        try:
            if path.is_dir():
                shutil.rmtree(path)
                removed += 1
            elif path.exists():
                path.unlink()
                removed += 1
        except OSError:
            logger.warning("Could not remove generated asset %s", path, exc_info=True)
    return removed
