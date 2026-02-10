import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_metadata(file_path: str) -> dict:
    """Extract duration and file_size from a video using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                file_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning("ffprobe failed for %s: %s", file_path, result.stderr[:500])
            return {"duration": None, "file_size": None}

        data = json.loads(result.stdout.decode("utf-8", errors="replace"))
        fmt = data.get("format", {})
        duration = int(float(fmt["duration"])) if "duration" in fmt else None
        file_size = int(fmt["size"]) if "size" in fmt else None
        return {"duration": duration, "file_size": file_size}
    except Exception:
        logger.exception("Error extracting metadata from %s", file_path)
        return {"duration": None, "file_size": None}


def generate_thumbnail(
    video_path: str, output_path: str, timestamp: str = "00:00:05"
) -> bool:
    """Generate a JPEG thumbnail from a video at the given timestamp."""
    try:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [
                "ffmpeg",
                "-ss", timestamp,
                "-i", video_path,
                "-vframes", "1",
                "-q:v", "2",
                "-y",
                output_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning("ffmpeg thumbnail failed for %s: %s", video_path, result.stderr[:500])
            return False
        return Path(output_path).exists()
    except Exception:
        logger.exception("Error generating thumbnail for %s", video_path)
        return False
