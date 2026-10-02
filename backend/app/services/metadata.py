import json
import logging
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)


class HlsCancelled(Exception):
    """Raised when a transcode was stopped on request rather than failing."""


# How long a terminated ffmpeg is given to exit before it is killed outright.
_TERMINATE_GRACE_SECONDS = 5
# How often a running encode is checked for cancellation.
_CANCEL_POLL_SECONDS = 1.0


def _discard_hls_output(out_dir: Path) -> None:
    """Remove a failed transcode's directory so the next attempt starts clean.

    Leaving partial output behind is what makes a single timeout permanent: the
    playlist exists, so it gets served and never regenerated.
    """
    try:
        shutil.rmtree(out_dir, ignore_errors=True)
    except OSError:
        logger.warning("Could not remove incomplete HLS output at %s", out_dir)


def _stop_process(proc: subprocess.Popen) -> None:
    """End an ffmpeg process, escalating to SIGKILL if it ignores SIGTERM."""
    proc.terminate()
    try:
        proc.wait(timeout=_TERMINATE_GRACE_SECONDS)
        return
    except subprocess.TimeoutExpired:
        pass
    proc.kill()
    try:
        proc.wait(timeout=_TERMINATE_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg pid %s survived SIGKILL", proc.pid)


def _run_ffmpeg_cancellable(
    command: list[str],
    *,
    timeout: int,
    should_cancel: Callable[[], bool] | None,
) -> tuple[int | None, bytes]:
    """Run ffmpeg so it can be stopped mid-encode. Returns (returncode, stderr).

    Raises HlsCancelled if cancellation was requested, and TimeoutExpired if the
    budget ran out, matching what subprocess.run would have raised.

    stderr is written to a temporary file rather than a pipe. Nothing drains the
    pipe while this loop is polling, and ffmpeg is talkative enough to fill the
    buffer and then block forever waiting for someone to read it.
    """
    with tempfile.TemporaryFile() as stderr_file:
        proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=stderr_file)
        deadline = time.monotonic() + timeout
        try:
            while True:
                try:
                    proc.wait(timeout=_CANCEL_POLL_SECONDS)
                    break
                except subprocess.TimeoutExpired:
                    pass
                if should_cancel is not None and should_cancel():
                    _stop_process(proc)
                    raise HlsCancelled()
                if time.monotonic() >= deadline:
                    _stop_process(proc)
                    raise subprocess.TimeoutExpired(command, timeout)
        finally:
            # Never leave an encode running behind a raised exception.
            if proc.poll() is None:
                _stop_process(proc)

        stderr_file.seek(0)
        return proc.returncode, stderr_file.read()


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
                # Cards show this at ~300px and the hero preview is 360p, so a
                # source-resolution frame (4K is ~570KB) is pure download cost.
                # 540p stays sharp at 2x DPR; min() avoids upscaling small sources.
                "-vf", "scale=-2:'min(540,ih)'",
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


def playlist_is_complete(playlist_path: str | Path) -> bool:
    """Whether an HLS playlist represents a finished transcode.

    A playlist without #EXT-X-ENDLIST is a *live* stream as far as the HLS spec
    is concerned, so players show no seek bar and start at the live edge rather
    than at zero. ffmpeg only writes that tag when it exits cleanly, which means
    a killed or timed-out transcode leaves a file that looks usable but plays
    like a broadcast. Existence is therefore not enough -- callers must check
    this before serving or reusing a playlist.
    """
    try:
        path = Path(playlist_path)
        if not path.is_file():
            return False
        # The tag is written last, so only the tail needs reading.
        with path.open("rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - 512))
            return b"#EXT-X-ENDLIST" in handle.read()
    except OSError:
        return False


def _hls_timeout_seconds(video_path: str) -> int:
    """Wall-clock budget for one transcode, scaled to the source duration.

    A flat ceiling silently truncates longer videos: several concurrent 4K
    encodes contending for the same cores run well behind real time, so a fixed
    300s cut every source over roughly three minutes in half. Allow 8x realtime
    plus a fixed floor, which covers heavy contention while still bounding a
    genuinely stuck ffmpeg.
    """
    duration = extract_metadata(video_path).get("duration")
    if not duration or duration <= 0:
        return 1800
    return int(min(7200, max(600, duration * 8)))


def generate_hls(
    video_path: str,
    output_dir: str,
    should_cancel: Callable[[], bool] | None = None,
) -> str | None:
    """Generate a simple HLS stream (single variant) and return the playlist path.

    Raises HlsCancelled if should_cancel starts returning True mid-encode, having
    first discarded the partial output. Discarding is what makes a cancelled
    video count as untranscoded again: coverage is read from disk, so removing
    the directory is the whole of "mark it as not done".
    """
    out_dir = Path(output_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        playlist = out_dir / "index.m3u8"
        segment_pattern = out_dir / "segment_%03d.ts"
        returncode, stderr = _run_ffmpeg_cancellable(
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
                # Marks the result as a finished recording rather than a live
                # stream, so players expose a seek bar and start at zero.
                "-hls_playlist_type",
                "vod",
                "-hls_segment_filename",
                str(segment_pattern),
                "-f",
                "hls",
                "-y",
                str(playlist),
            ],
            timeout=_hls_timeout_seconds(video_path),
            should_cancel=should_cancel,
        )
        if returncode != 0:
            logger.warning(
                "ffmpeg HLS failed for %s -> %s: %s",
                video_path,
                output_dir,
                _ffmpeg_error(stderr),
            )
            _discard_hls_output(out_dir)
            return None
        if not playlist_is_complete(playlist):
            # ffmpeg exited 0 without a trailer. Keeping this would serve a
            # seekless, mid-start stream forever, and because the file exists
            # nothing would ever retry it.
            logger.warning(
                "ffmpeg HLS produced an incomplete playlist for %s -> %s",
                video_path,
                output_dir,
            )
            _discard_hls_output(out_dir)
            return None
        return str(playlist)
    except HlsCancelled:
        # Must be caught before the generic handler below, which would otherwise
        # turn a deliberate stop into an indistinguishable failure.
        logger.info(
            "ffmpeg HLS cancelled for %s -> %s; discarding partial output",
            video_path,
            output_dir,
        )
        _discard_hls_output(out_dir)
        raise
    except subprocess.TimeoutExpired:
        logger.warning(
            "ffmpeg HLS timed out for %s -> %s; discarding partial output",
            video_path,
            output_dir,
        )
        _discard_hls_output(out_dir)
        return None
    except Exception:
        logger.exception("Error generating HLS for %s", video_path)
        _discard_hls_output(out_dir)
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
