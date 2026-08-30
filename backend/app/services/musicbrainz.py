"""MusicBrainz metadata search, a no-account alternative to Spotify.

Returns the same result shape as ``spotify.search_tracks`` so the search
endpoint and frontend can consume either provider without branching on the
result. MusicBrainz needs no auth, only a descriptive User-Agent, and asks
for at most ~1 request/second; a single search here is one request.
"""

import asyncio
import logging

import httpx

from app.core.config import settings
from app.core.rate_limit import rate_limiter
from app.services.spotify import (
    _parse_retry_after_seconds,
    _parse_year,
    _sanitize_query,
)

logger = logging.getLogger(__name__)


def _musicbrainz_backoff_seconds(attempt: int) -> float:
    # Exponential, but capped so a single manual search never stalls for long.
    base = max(0.1, float(settings.EXTERNAL_API_RETRY_BACKOFF_SECONDS))
    return min(2.0, base * (2**attempt))

MUSICBRAINZ_SEARCH_URL = "https://musicbrainz.org/ws/2/recording"
# MusicBrainz rejects generic/absent User-Agents; identify the app + a contact.
_USER_AGENT = "Popinn/1.0 ( https://github.com/popinn/popinn )"


class MusicBrainzServiceError(RuntimeError):
    pass


def _lucene_escape(value: str) -> str:
    # Drop the quote/backslash chars that would break the phrase we wrap it in.
    return value.replace("\\", " ").replace('"', " ").strip()


def _build_query(query: str, artist_name: str | None) -> str:
    title = _sanitize_query(query.strip()) or query.strip()
    title = _lucene_escape(title)
    parts: list[str] = []
    if title:
        parts.append(f'recording:"{title}"')
    if artist_name and artist_name.strip():
        artist = _lucene_escape(artist_name)
        if artist:
            parts.append(f'artist:"{artist}"')
    return " AND ".join(parts)


async def search_tracks(
    *,
    query: str,
    artist_name: str | None = None,
    limit: int = 10,
) -> list[dict]:
    lucene = _build_query(query, artist_name)
    if not lucene:
        return []
    params = {"query": lucene, "fmt": "json", "limit": max(1, min(limit, 20))}
    headers = {"User-Agent": _USER_AGENT}
    attempts = max(1, settings.MUSICBRAINZ_MAX_RETRIES + 1)

    async with httpx.AsyncClient(timeout=15) as client:
        for attempt in range(attempts):
            # MusicBrainz throttles to ~1 request/second per IP, so pace globally
            # (across all callers) before each try to avoid tripping its 503.
            await rate_limiter.async_wait(
                "musicbrainz_api", "global", settings.MUSICBRAINZ_API_RATE_LIMIT
            )
            try:
                resp = await client.get(MUSICBRAINZ_SEARCH_URL, params=params, headers=headers)
            except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt < attempts - 1:
                    await asyncio.sleep(_musicbrainz_backoff_seconds(attempt))
                    continue
                raise MusicBrainzServiceError("MusicBrainz request failed due to network issues.") from exc

            # The public server returns a transient 503 ("busy") often, even while
            # we're under quota, so retry it persistently with a capped backoff.
            if resp.status_code == 503:
                if attempt < attempts - 1:
                    delay = _parse_retry_after_seconds(resp) or _musicbrainz_backoff_seconds(attempt)
                    logger.warning(
                        "MusicBrainz 503 (busy); retrying in %.1fs (%s/%s).",
                        delay,
                        attempt + 1,
                        attempts,
                    )
                    await asyncio.sleep(delay)
                    continue
                raise MusicBrainzServiceError(
                    "MusicBrainz is busy right now. Please try the search again in a moment."
                )
            if resp.status_code >= 400:
                raise MusicBrainzServiceError(f"MusicBrainz rejected the request ({resp.status_code}).")

            try:
                return _recordings_to_results(resp.json())
            except ValueError as exc:
                raise MusicBrainzServiceError("MusicBrainz returned an invalid response.") from exc

    raise MusicBrainzServiceError("MusicBrainz request failed.")


def _recordings_to_results(data: dict) -> list[dict]:
    results: list[dict] = []
    for rec in data.get("recordings", []) or []:
        credits = rec.get("artist-credit") or []
        artist_names = [c.get("name") for c in credits if c.get("name")]
        releases = rec.get("releases") or []
        first_release = releases[0] if releases else {}
        # ponytail: genre only when the search payload already carries tags;
        # per-recording tag lookups would cost one rate-limited call each.
        tags = rec.get("tags") or []
        genre = tags[0].get("name") if tags and tags[0].get("name") else None
        results.append(
            {
                # Reused key name so the response matches SpotifyTrackMatch; the
                # frontend only uses it as a list key, never sends it back.
                "spotify_track_id": rec.get("id") or "",
                "title": rec.get("title") or "",
                "album": first_release.get("title"),
                "year": _parse_year(first_release.get("date")),
                "genre": genre,
                "artist_name": artist_names[0] if artist_names else None,
                "artist_names": artist_names,
            }
        )
    return results


if __name__ == "__main__":  # pragma: no cover - smallest self-check
    assert _build_query("Hello (Official Video)", "Adele") == 'recording:"Hello" AND artist:"Adele"'
    assert _build_query('a "quoted" title', None) == 'recording:"a quoted title"'
    sample = {
        "recordings": [
            {
                "id": "mbid-1",
                "title": "Hello",
                "artist-credit": [{"name": "Adele"}],
                "releases": [{"title": "25", "date": "2015-11-20"}],
                "tags": [{"name": "pop", "count": 3}],
            }
        ]
    }
    out = _recordings_to_results(sample)
    assert out == [
        {
            "spotify_track_id": "mbid-1",
            "title": "Hello",
            "album": "25",
            "year": 2015,
            "genre": "pop",
            "artist_name": "Adele",
            "artist_names": ["Adele"],
        }
    ], out
    print("musicbrainz self-check OK")
