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


def generate_hls(video_path: str, output_dir: str) -> str | None:
    """Generate a simple HLS stream (single variant) and return the playlist path."""
    try:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        playlist = out_dir / "index.m3u8"
        segment_pattern = out_dir / "segment_%03d.ts"
        result = subprocess.run(
            [
                "ffmpeg",
                "-i",
                video_path,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-hls_time",
                "6",
                "-hls_list_size",
                "0",
                "-hls_segment_filename",
                str(segment_pattern),
                "-f",
                "hls",
                "-y",
                str(playlist),
            ],
            capture_output=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.warning("ffmpeg HLS failed for %s: %s", video_path, result.stderr[:500])
            return None
        return str(playlist) if playlist.exists() else None
    except Exception:
        logger.exception("Error generating HLS for %s", video_path)
        return None
