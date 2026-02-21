import logging
from pathlib import Path
import re
import time
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
LASTFM_ATTRIBUTION_LINE = "Artist information powered by Last.fm"
LASTFM_LINK_PREFIX = "Last.fm:"

# Last.fm returns this hash for every artist that has no real image uploaded.
# It's a 4KB star/placeholder PNG. We must detect and skip it.
LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"


def _retry_attempts() -> int:
    # Example: EXTERNAL_API_MAX_RETRIES=2 -> up to 3 total attempts.
    return max(1, settings.EXTERNAL_API_MAX_RETRIES + 1)


def _retry_backoff_seconds(attempt: int) -> float:
    base = max(0.1, float(settings.EXTERNAL_API_RETRY_BACKOFF_SECONDS))
    return base * (2**attempt)


def _parse_retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _request_json_with_retries(
    *,
    url: str,
    params: dict | None,
    timeout_seconds: float,
    rate_bucket: str,
    context: str,
) -> dict | None:
    for attempt in range(_retry_attempts()):
        rate_limiter.wait(rate_bucket, "global", settings.LASTFM_API_RATE_LIMIT)
        try:
            with httpx.Client(timeout=timeout_seconds) as client:
                resp = client.get(url, params=params)
        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt < _retry_attempts() - 1:
                logger.warning(
                    "%s request failed (%s). Retrying (%s/%s).",
                    context,
                    type(exc).__name__,
                    attempt + 1,
                    _retry_attempts(),
                )
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            logger.warning("%s request failed after retries: %s", context, type(exc).__name__)
            return None

        if resp.status_code == 429:
            retry_after = _parse_retry_after_seconds(resp)
            if attempt < _retry_attempts() - 1:
                time.sleep(retry_after if retry_after is not None else _retry_backoff_seconds(attempt))
                continue
            logger.warning("%s rate-limited by upstream provider.", context)
            return None

        if resp.status_code >= 500:
            if attempt < _retry_attempts() - 1:
                time.sleep(_retry_backoff_seconds(attempt))
                continue
            logger.warning("%s failed with upstream status %s.", context, resp.status_code)
            return None

        if resp.status_code >= 400:
            logger.warning("%s failed with status %s.", context, resp.status_code)
            return None

        try:
            return resp.json()
        except ValueError:
            logger.warning("%s returned invalid JSON.", context)
            return None

    return None


def build_lastfm_artist_url(artist_name: str) -> str:
    encoded_artist = quote(artist_name.strip(), safe="")
    return f"https://www.last.fm/music/{encoded_artist}"


def _strip_existing_attribution(text: str) -> str:
    cleaned = re.sub(
        rf"\n*\s*{re.escape(LASTFM_ATTRIBUTION_LINE)}\s*\n*{re.escape(LASTFM_LINK_PREFIX)}\s*https?://www\.last\.fm/music/\S+\s*$",
        "",
        text.strip(),
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def is_lastfm_attributed_bio(text: str | None) -> bool:
    if not text:
        return False
    return LASTFM_ATTRIBUTION_LINE.lower() in text.lower()


def add_lastfm_attribution(bio_text: str | None, artist_name: str) -> str:
    cleaned_bio = _strip_existing_attribution(bio_text or "")
    url = build_lastfm_artist_url(artist_name)
    if cleaned_bio:
        return f"{cleaned_bio}\n\n{LASTFM_ATTRIBUTION_LINE}\n{LASTFM_LINK_PREFIX} {url}"
    return f"{LASTFM_ATTRIBUTION_LINE}\n{LASTFM_LINK_PREFIX} {url}"


def fetch_artist_info(artist_name: str, api_key: str) -> dict | None:
    """Fetch artist bio and image URL from Last.fm with attribution-compliant bio output."""
    try:
        data = _request_json_with_retries(
            url=LASTFM_API_URL,
            params={
                "method": "artist.getinfo",
                "artist": artist_name,
                "api_key": api_key,
                "format": "json",
            },
            timeout_seconds=15,
            rate_bucket="lastfm_api",
            context=f"Last.fm artist.getinfo ({artist_name})",
        )
        if not data:
            return None

        if data.get("error") is not None:
            error_code = data.get("error")
            message = data.get("message", "Unknown Last.fm API error")
            # Common "not found" case is expected and should not be noisy.
            try:
                parsed_code = int(error_code)
            except (TypeError, ValueError):
                parsed_code = None
            if parsed_code == 6:
                logger.info("Last.fm artist not found: %s", artist_name)
                return None
            logger.warning(
                "Last.fm API error for %s: code=%s message=%s",
                artist_name,
                error_code,
                message,
            )
            return None

        artist = data.get("artist")
        if not artist:
            return None

        bio_content = artist.get("bio", {}).get("summary", "")
        # Last.fm wraps links in <a> tags — strip them for clean text
        if bio_content:
            bio_content = re.sub(r"<a\b[^>]*>.*?</a>", "", bio_content).strip()

        images = artist.get("image", [])
        image_url = ""
        for img in reversed(images):
            url = img.get("#text", "")
            if url and LASTFM_PLACEHOLDER_HASH not in url:
                image_url = url
                break

        bio_with_attribution = add_lastfm_attribution(bio_content or None, artist_name)
        return {"bio": bio_with_attribution, "image_url": image_url or None}
    except Exception:
        logger.exception("Unexpected error fetching Last.fm info for %s", artist_name)
        return None


def download_artist_image(url: str, save_path: str) -> bool:
    """Download an image from a URL and save it locally."""
    try:
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        rate_limiter.wait("artist_image_download", "global", settings.LASTFM_API_RATE_LIMIT)
        with httpx.Client(timeout=30) as client:
            resp = client.get(url)
            resp.raise_for_status()
            content_type = (resp.headers.get("content-type") or "").lower()
            if "image" not in content_type:
                logger.warning("Rejected non-image response for artist image download: %s", url)
                return False
            Path(save_path).write_bytes(resp.content)
        return True
    except Exception:
        logger.exception("Error downloading artist image from %s", url)
        return False
