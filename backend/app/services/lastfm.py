import logging
from pathlib import Path
import re
import time
from urllib.parse import quote, unquote_plus, urlparse

import httpx

from app.core.config import settings
from app.core.rate_limit import rate_limiter

logger = logging.getLogger(__name__)

LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
DEEZER_ARTIST_SEARCH_URL = "https://api.deezer.com/search/artist"
LASTFM_ATTRIBUTION_LINE = "Artist information powered by Last.fm"
LASTFM_LINK_PREFIX = "Last.fm:"

# Last.fm returns this hash for every artist that has no real image uploaded.
# It's a 4KB star/placeholder PNG. We must detect and skip it.
LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"


def _normalize_image_url(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    if candidate.startswith("//"):
        candidate = f"https:{candidate}"
    if LASTFM_PLACEHOLDER_HASH in candidate:
        return None
    return candidate


def _extract_image_url(images: object) -> str | None:
    if not isinstance(images, list):
        return None
    size_score = {
        "mega": 5,
        "extralarge": 4,
        "large": 3,
        "medium": 2,
        "small": 1,
    }
    best: tuple[int, str] | None = None
    for img in images:
        if not isinstance(img, dict):
            continue
        candidate = _normalize_image_url(img.get("#text"))
        if not candidate:
            continue
        score = size_score.get(str(img.get("size") or "").lower(), 0)
        if best is None or score > best[0]:
            best = (score, candidate)
    return best[1] if best else None


def _select_search_match(results: list[dict], artist_name: str) -> dict | None:
    if not results:
        return None
    target = normalize_for_match(artist_name)
    exact = next(
        (
            item
            for item in results
            if normalize_for_match(str(item.get("name") or "")) == target and item.get("image_url")
        ),
        None,
    )
    if exact:
        return exact
    with_image = next((item for item in results if item.get("image_url")), None)
    return with_image or results[0]


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


def _fetch_deezer_image_url(artist_name: str) -> str | None:
    # Last.fm stopped serving artist images through its API in 2019, and its
    # artist pages now answer non-browser clients with a bot challenge, so the
    # og:image scrape that used to fill the gap returns nothing. Deezer's search
    # is keyless. Common names have many namesakes ("Twice" matches a dozen
    # artists), so take the exact name match with the most fans.
    data = _request_json_with_retries(
        url=DEEZER_ARTIST_SEARCH_URL,
        params={"q": artist_name, "limit": 25},
        timeout_seconds=15,
        rate_bucket="deezer_api",
        context=f"Deezer artist search ({artist_name})",
    )
    rows = (data or {}).get("data")
    if not isinstance(rows, list):
        return None
    target = normalize_for_match(artist_name)
    matches = [
        row
        for row in rows
        if isinstance(row, dict)
        and normalize_for_match(str(row.get("name") or "")) == target
        and row.get("picture_xl")
    ]
    if not matches:
        return None
    best = max(matches, key=lambda row: row.get("nb_fan") or 0)
    return _normalize_image_url(best["picture_xl"])


def build_lastfm_artist_url(artist_name: str) -> str:
    encoded_artist = quote(artist_name.strip(), safe="")
    return f"https://www.last.fm/music/{encoded_artist}"


# Hosts a Last.fm artist link is accepted from. Anything else is rejected rather
# than guessed at, so a mistyped or unrelated URL fails loudly.
_LASTFM_HOSTS = {"last.fm", "www.last.fm", "m.last.fm"}
# Trailing path segments Last.fm appends to an artist page (/+wiki, /+images,
# /+albums, ...) plus subpages such as /_/Track for a specific song.
_LASTFM_SUBPAGE_PREFIXES = ("+", "_")


def parse_lastfm_artist_url(url: str) -> str | None:
    """Extract the artist name from a Last.fm artist URL.

    Accepts the forms a browser produces, including a locale prefix
    (/es/music/...) and any of the artist subpages (/+wiki, /+images). Returns
    None if this is not a Last.fm artist URL.

    Names arrive percent-encoded with spaces as "+", which is exactly what
    unquote_plus reverses -- and it correctly leaves a literal "+" in a name
    (encoded as %2B) alone.
    """
    candidate = (url or "").strip()
    if not candidate:
        return None
    # Tolerate a pasted "www.last.fm/music/..." with no scheme, which urlparse
    # would otherwise read as a path with no host.
    if "//" not in candidate:
        candidate = f"https://{candidate}"

    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"}:
        return None
    if (parsed.hostname or "").lower() not in _LASTFM_HOSTS:
        return None

    segments = [segment for segment in parsed.path.split("/") if segment]
    try:
        music_at = segments.index("music")
    except ValueError:
        return None
    if music_at + 1 >= len(segments):
        return None

    # Tested before decoding: unquote_plus turns a leading "+" into a space,
    # so /music/+wiki would otherwise decode to the artist name "wiki".
    raw_name = segments[music_at + 1]
    if raw_name.startswith(_LASTFM_SUBPAGE_PREFIXES):
        return None

    name = unquote_plus(raw_name).strip()
    return name or None


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


def normalize_for_match(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch.lower() for ch in value if ch.isalnum())


def _coerce_match_score(value: str | float | int | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_similar_artists(
    artist_name: str,
    api_key: str,
    *,
    limit: int = 100,
) -> list[dict]:
    data = _request_json_with_retries(
        url=LASTFM_API_URL,
        params={
            "method": "artist.getsimilar",
            "artist": artist_name,
            "api_key": api_key,
            "format": "json",
            "autocorrect": 1,
            "limit": max(1, min(limit, 200)),
        },
        timeout_seconds=15,
        rate_bucket="lastfm_api",
        context=f"Last.fm artist.getsimilar ({artist_name})",
    )
    if not data:
        return []
    if data.get("error") is not None:
        logger.info("Last.fm artist.getsimilar returned error for %s: %s", artist_name, data.get("message"))
        return []

    similar = (data.get("similarartists") or {}).get("artist") or []
    if isinstance(similar, dict):
        similar = [similar]

    items: list[dict] = []
    for row in similar:
        name = (row or {}).get("name")
        if not name:
            continue
        items.append(
            {
                "name": name,
                "match": _coerce_match_score((row or {}).get("match")),
            }
        )
    return items


def search_artists(
    query: str,
    api_key: str,
    *,
    limit: int = 10,
) -> list[dict]:
    data = _request_json_with_retries(
        url=LASTFM_API_URL,
        params={
            "method": "artist.search",
            "artist": query,
            "api_key": api_key,
            "format": "json",
            "limit": max(1, min(limit, 50)),
        },
        timeout_seconds=15,
        rate_bucket="lastfm_api",
        context=f"Last.fm artist.search ({query})",
    )
    if not data:
        return []
    if data.get("error") is not None:
        logger.info("Last.fm artist.search returned error for %s: %s", query, data.get("message"))
        return []

    matches = (
        (data.get("results") or {})
        .get("artistmatches", {})
        .get("artist", [])
    )
    if isinstance(matches, dict):
        matches = [matches]

    items: list[dict] = []
    for row in matches:
        row = row or {}
        name = row.get("name")
        if not name:
            continue
        image_url = _extract_image_url(row.get("image"))

        items.append(
            {
                "name": name,
                "image_url": image_url,
                "url": row.get("url"),
            }
        )
    return items


def fetch_similar_tracks(
    track_name: str,
    artist_name: str,
    api_key: str,
    *,
    limit: int = 100,
) -> list[dict]:
    data = _request_json_with_retries(
        url=LASTFM_API_URL,
        params={
            "method": "track.getsimilar",
            "track": track_name,
            "artist": artist_name,
            "api_key": api_key,
            "format": "json",
            "autocorrect": 1,
            "limit": max(1, min(limit, 200)),
        },
        timeout_seconds=15,
        rate_bucket="lastfm_api",
        context=f"Last.fm track.getsimilar ({artist_name} - {track_name})",
    )
    if not data:
        return []
    if data.get("error") is not None:
        logger.info("Last.fm track.getsimilar returned error for %s - %s: %s", artist_name, track_name, data.get("message"))
        return []

    similar = (data.get("similartracks") or {}).get("track") or []
    if isinstance(similar, dict):
        similar = [similar]

    items: list[dict] = []
    for row in similar:
        row = row or {}
        title = row.get("name")
        if not title:
            continue
        row_artist = row.get("artist")
        if isinstance(row_artist, dict):
            row_artist_name = row_artist.get("name")
        else:
            row_artist_name = row_artist
        if not row_artist_name:
            continue
        items.append(
            {
                "title": title,
                "artist_name": row_artist_name,
                "match": _coerce_match_score(row.get("match")),
            }
        )
    return items


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

        image_url = _extract_image_url(artist.get("image"))

        canonical_name = (artist.get("name") or "").strip() or artist_name
        if not image_url:
            search_results = search_artists(canonical_name, api_key, limit=8)
            matched = _select_search_match(search_results, canonical_name)
            if matched:
                image_url = _normalize_image_url(matched.get("image_url"))
                if matched.get("name"):
                    canonical_name = str(matched["name"]).strip() or canonical_name
        if not image_url:
            image_url = _fetch_deezer_image_url(canonical_name)
        if not image_url and canonical_name != artist_name:
            image_url = _fetch_deezer_image_url(artist_name)

        bio_with_attribution = add_lastfm_attribution(bio_content or None, canonical_name)
        return {
            "bio": bio_with_attribution,
            "image_url": image_url or None,
            "artist_name": canonical_name,
            "url": build_lastfm_artist_url(canonical_name),
        }
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
