import asyncio
import base64
import logging
import re
import time

import httpx

from app.core.config import settings
from app.core.rate_limit import rate_limiter

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"
SPOTIFY_ARTISTS_URL = "https://api.spotify.com/v1/artists"

logger = logging.getLogger(__name__)

_token_lock = asyncio.Lock()
_token_value: str | None = None
_token_expires_at: float = 0.0


class SpotifyServiceError(RuntimeError):
    pass


class SpotifyRateLimitError(SpotifyServiceError):
    def __init__(self, message: str, retry_after_seconds: float | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


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


async def _request_json_with_retries(
    client: httpx.AsyncClient,
    *,
    method: str,
    url: str,
    context: str,
    headers: dict[str, str] | None = None,
    params: dict | None = None,
    data: dict | None = None,
) -> dict:
    for attempt in range(_retry_attempts()):
        await rate_limiter.async_wait("spotify_api", "global", settings.SPOTIFY_API_RATE_LIMIT)
        try:
            resp = await client.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                data=data,
            )
        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt < _retry_attempts() - 1:
                logger.warning(
                    "Spotify %s request failed (%s). Retrying (%s/%s).",
                    context,
                    type(exc).__name__,
                    attempt + 1,
                    _retry_attempts(),
                )
                await asyncio.sleep(_retry_backoff_seconds(attempt))
                continue
            raise SpotifyServiceError("Spotify API request failed due to network issues.") from exc

        if resp.status_code == 429:
            retry_after = _parse_retry_after_seconds(resp)
            if attempt < _retry_attempts() - 1:
                await asyncio.sleep(retry_after if retry_after is not None else _retry_backoff_seconds(attempt))
                continue
            raise SpotifyRateLimitError(
                "Spotify API rate limit exceeded.",
                retry_after_seconds=retry_after,
            )

        if resp.status_code >= 500:
            if attempt < _retry_attempts() - 1:
                logger.warning(
                    "Spotify %s returned %s. Retrying (%s/%s).",
                    context,
                    resp.status_code,
                    attempt + 1,
                    _retry_attempts(),
                )
                await asyncio.sleep(_retry_backoff_seconds(attempt))
                continue
            raise SpotifyServiceError("Spotify API is temporarily unavailable.")

        if resp.status_code >= 400:
            if resp.status_code in {401, 403}:
                raise SpotifyServiceError("Spotify API credentials are invalid or unauthorized.")
            raise SpotifyServiceError(f"Spotify API rejected the {context} request.")

        try:
            return resp.json()
        except ValueError as exc:
            if attempt < _retry_attempts() - 1:
                await asyncio.sleep(_retry_backoff_seconds(attempt))
                continue
            raise SpotifyServiceError("Spotify API returned an invalid JSON response.") from exc

    raise SpotifyServiceError("Spotify API request failed.")


async def _fetch_access_token(client_id: str, client_secret: str) -> tuple[str, int]:
    creds = f"{client_id}:{client_secret}".encode("utf-8")
    basic = base64.b64encode(creds).decode("utf-8")
    headers = {"Authorization": f"Basic {basic}"}
    data = {"grant_type": "client_credentials"}

    async with httpx.AsyncClient(timeout=15) as client:
        payload = await _request_json_with_retries(
            client,
            method="POST",
            url=SPOTIFY_TOKEN_URL,
            headers=headers,
            data=data,
            context="token",
        )

    token = payload.get("access_token")
    expires_in = int(payload.get("expires_in") or 3600)
    if not token:
        raise SpotifyServiceError("Spotify token response missing access_token.")
    return token, expires_in


async def get_access_token(client_id: str, client_secret: str) -> str:
    global _token_value, _token_expires_at
    now = time.time()
    if _token_value and now < _token_expires_at:
        return _token_value

    async with _token_lock:
        now = time.time()
        if _token_value and now < _token_expires_at:
            return _token_value

        token, expires_in = await _fetch_access_token(client_id, client_secret)
        _token_value = token
        _token_expires_at = now + max(60, expires_in - 60)
        return token


def _parse_year(release_date: str | None) -> int | None:
    if not release_date:
        return None
    year = (release_date or "")[:4]
    if len(year) == 4 and year.isdigit():
        return int(year)
    return None


def _sanitize_query(query: str) -> str:
    sanitized = query
    # Remove common music video postfixes/noise phrases.
    for pattern in [
        r"\bofficial\s+music\s+video\b",
        r"\bofficial\s+lyric\s+video\b",
        r"\bofficial\s+video\b",
        r"\bmusic\s+video\b",
        r"\bexclusive\s+performance\s+video\b",
        r"\bperformance\s+video\b",
        r"\bspecial\s+clip\b",
        r"\bspecial\s+film\b",
        r"\bcover\s*\(\s*special\s+present\s*\)\b",
        r"\bm\s*/\s*v\b",
        r"\bmv\b",
    ]:
        sanitized = re.sub(pattern, " ", sanitized, flags=re.IGNORECASE)

    # Remove brackets and quote marks while preserving the enclosed words.
    sanitized = re.sub(r"[()\[\]{}\"'`“”‘’]", " ", sanitized)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized


async def search_tracks(
    *,
    client_id: str,
    client_secret: str,
    query: str,
    artist_name: str | None = None,
    limit: int = 10,
) -> list[dict]:
    token = await get_access_token(client_id, client_secret)
    search_query = _sanitize_query(query.strip())
    if not search_query:
        search_query = query.strip()
    if artist_name and artist_name.strip():
        search_query = f"{search_query} artist:{artist_name.strip()}"

    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "q": search_query,
        "type": "track",
        "limit": max(1, min(limit, 20)),
        "market": "US",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        search_data = await _request_json_with_retries(
            client,
            method="GET",
            url=SPOTIFY_SEARCH_URL,
            params=params,
            headers=headers,
            context="track search",
        )
        tracks = search_data.get("tracks", {}).get("items", [])

        artist_ids: list[str] = []
        for track in tracks:
            artists = track.get("artists") or []
            if not artists:
                continue
            aid = artists[0].get("id")
            if aid and aid not in artist_ids:
                artist_ids.append(aid)

        genres_by_artist_id: dict[str, str | None] = {}
        if artist_ids:
            # Genre is optional enrichment: Spotify may 403 the batch artists
            # endpoint (restricted for some apps), so never let it fail the search.
            try:
                artists_data = await _request_json_with_retries(
                    client,
                    method="GET",
                    url=SPOTIFY_ARTISTS_URL,
                    params={"ids": ",".join(artist_ids[:50])},
                    headers=headers,
                    context="artist lookup",
                )
                for artist in artists_data.get("artists", []) or []:
                    genres = artist.get("genres") or []
                    genres_by_artist_id[artist.get("id")] = genres[0] if genres else None
            except SpotifyServiceError as exc:
                logger.warning("Spotify artist genre lookup failed, continuing without genres: %s", exc)

    results: list[dict] = []
    for track in tracks:
        artists = track.get("artists") or []
        primary_artist = artists[0] if artists else {}
        primary_artist_id = primary_artist.get("id")
        results.append(
            {
                "spotify_track_id": track.get("id"),
                "title": track.get("name") or "",
                "album": (track.get("album") or {}).get("name"),
                "year": _parse_year((track.get("album") or {}).get("release_date")),
                "genre": genres_by_artist_id.get(primary_artist_id),
                "artist_name": primary_artist.get("name") or None,
                "artist_names": [a.get("name") for a in artists if a.get("name")],
            }
        )

    return results


# Artist image URLs looked up for display. Spotify's terms do not allow storing
# its content, so this is only an in-memory cache of the URL, never the image.
_ARTIST_IMAGE_TTL_SECONDS = 6 * 3600
_artist_image_cache: dict[str, tuple[str | None, float]] = {}
_ARTIST_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")


def _normalize_name(value: str | None) -> str:
    return "".join(ch.lower() for ch in (value or "") if ch.isalnum())


def parse_spotify_artist_id(value: str) -> str | None:
    """Artist ID from an open.spotify.com/artist/... link, a spotify:artist:... URI or a bare ID."""
    candidate = (value or "").strip()
    match = re.search(r"(?:open\.spotify\.com/(?:[a-z-]+/)?artist/|spotify:artist:)([A-Za-z0-9]{22})", candidate)
    if match:
        return match.group(1)
    return candidate if _ARTIST_ID_RE.match(candidate) else None


async def _artist_api(path: str, params: dict | None, context: str) -> dict:
    token = await get_access_token(settings.SPOTIFY_CLIENT_ID.strip(), settings.SPOTIFY_CLIENT_SECRET.strip())
    async with httpx.AsyncClient(timeout=15) as client:
        return await _request_json_with_retries(
            client,
            method="GET",
            url=path,
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            context=context,
        )


def _artist_item(artist: dict) -> dict:
    images = artist.get("images") or []
    return {
        "id": artist.get("id"),
        "name": artist.get("name") or "",
        "image_url": images[0].get("url") if images else None,
        "followers": (artist.get("followers") or {}).get("total"),
        "genres": artist.get("genres") or [],
        "url": (artist.get("external_urls") or {}).get("spotify"),
    }


async def search_artists(query: str, *, limit: int = 10) -> list[dict]:
    data = await _artist_api(SPOTIFY_SEARCH_URL, {"q": query, "type": "artist", "limit": max(1, min(limit, 20))}, "artist search")
    return [
        _artist_item(a)
        for a in (data.get("artists") or {}).get("items") or []
        if isinstance(a, dict) and a.get("id")
    ]


async def get_artist(artist_id: str) -> dict:
    return _artist_item(await _artist_api(f"{SPOTIFY_ARTISTS_URL}/{artist_id}", None, "artist lookup"))


async def find_artist_image_url(artist_name: str, spotify_artist_id: str | None = None) -> str | None:
    """Image URL of the artist's Spotify profile, or None.

    A pinned spotify_artist_id (chosen by an admin) is used as is. Otherwise
    the name is searched: namesakes are common ("Twice" matches several
    artists), so among matches prefer the exact spelling ("YUNA" of ITZY over
    the bigger Malaysian "Yuna"), then the most followers, then Spotify's
    top-ranked.
    """
    key = f"id:{spotify_artist_id}" if spotify_artist_id else _normalize_name(artist_name)
    if not key:
        return None
    cached = _artist_image_cache.get(key)
    if cached and cached[1] > time.time():
        return cached[0]

    if spotify_artist_id:
        url = (await get_artist(spotify_artist_id))["image_url"]
    else:
        exact = artist_name.strip()
        matches = [
            a for a in await search_artists(artist_name)
            if _normalize_name(a["name"]) == key and a["image_url"]
        ]
        best = max(matches, key=lambda a: (a["name"] == exact, a["followers"] or 0), default=None)
        url = best["image_url"] if best else None
    _artist_image_cache[key] = (url, time.time() + _ARTIST_IMAGE_TTL_SECONDS)
    return url
