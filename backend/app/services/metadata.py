import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def _ffmpeg_error(stderr: bytes | None, limit: int = 500) -> str:
    """Return the tail of ffmpeg/ffprobe stderr, where the actual error lives.

    Taking the head instead yields only the version banner, which hides real
    causes such as the output directory not being writable.
    """
    if not stderr:
        return "<no stderr>"
    text = stderr.decode("utf-8", errors="replace").strip()
    return text[-limit:] if len(text) > limit else text


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
            logger.warning("ffprobe failed for %s: %s", file_path, _ffmpeg_error(result.stderr))
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
            logger.warning(
                "ffmpeg thumbnail failed for %s -> %s: %s",
                video_path,
                output_path,
                _ffmpeg_error(result.stderr),
            )
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
                # Cap the ladder at 1080p. Without this the source resolution is
                # kept, so a 4K master is re-encoded at 4K -- which is what made
                # a single transcode hold ~2.7GB resident. Two stages because
                # pairing force_original_aspect_ratio with a -2 dimension makes
                # libx264 reject the computed size on unusually wide sources
                # (e.g. 3840x1770); the trunc pass just keeps both sides even.
                "-vf",
                (
                    "scale=1920:1080:force_original_aspect_ratio=decrease,"
                    "scale=trunc(iw/2)*2:trunc(ih/2)*2"
                ),
                # libx264 defaults to ~1.5x the host's core count, and each
                # thread carries its own lookahead frame buffers. Unbounded that
                # dwarfs the encode itself once several jobs run in parallel.
                "-threads",
                "4",
                "-pix_fmt",
                "yuv420p",
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
            logger.warning(
                "ffmpeg HLS failed for %s -> %s: %s",
                video_path,
                output_dir,
                _ffmpeg_error(result.stderr),
            )
            return None
        return str(playlist) if playlist.exists() else None
    except Exception:
        logger.exception("Error generating HLS for %s", video_path)
        return None


def generate_preview_clip(
    video_path: str,
    output_path: str,
    *,
    start_seconds: int = 5,
    clip_seconds: int = 10,
) -> bool:
    """Generate a low-bitrate, muted preview clip for UI autoplay previews."""
    try:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        safe_start = max(0, int(start_seconds))
        safe_duration = max(2, int(clip_seconds))
        result = subprocess.run(
            [
                "ffmpeg",
                "-ss",
                str(safe_start),
                "-i",
                video_path,
                "-t",
                str(safe_duration),
                "-vf",
                # A -2 width already preserves the aspect ratio, and pairing it
                # with force_original_aspect_ratio makes libx264 reject the
                # computed size on unusually wide sources (e.g. 3840x1770).
                "scale=-2:360",
                "-c:v",
                "libx264",
                "-profile:v",
                "baseline",
                "-level",
                "3.0",
                "-preset",
                "veryfast",
                "-b:v",
                "500k",
                "-maxrate",
                "700k",
                "-bufsize",
                "1000k",
                "-an",
                "-movflags",
                "+faststart",
                "-y",
                output_path,
            ],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning(
                "ffmpeg preview clip failed for %s -> %s: %s",
                video_path,
                output_path,
                _ffmpeg_error(result.stderr),
            )
            return False
        return Path(output_path).exists()
    except Exception:
        logger.exception("Error generating preview clip for %s", video_path)
        return False
