import asyncio
import base64
import time

import httpx

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"
SPOTIFY_ARTISTS_URL = "https://api.spotify.com/v1/artists"

_token_lock = asyncio.Lock()
_token_value: str | None = None
_token_expires_at: float = 0.0


async def _fetch_access_token(client_id: str, client_secret: str) -> tuple[str, int]:
    creds = f"{client_id}:{client_secret}".encode("utf-8")
    basic = base64.b64encode(creds).decode("utf-8")
    headers = {"Authorization": f"Basic {basic}"}
    data = {"grant_type": "client_credentials"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(SPOTIFY_TOKEN_URL, data=data, headers=headers)
        resp.raise_for_status()
        payload = resp.json()

    token = payload.get("access_token")
    expires_in = int(payload.get("expires_in") or 3600)
    if not token:
        raise RuntimeError("Spotify token response missing access_token")
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


async def search_tracks(
    *,
    client_id: str,
    client_secret: str,
    query: str,
    artist_name: str | None = None,
    limit: int = 10,
) -> list[dict]:
    token = await get_access_token(client_id, client_secret)
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
        search_resp = await client.get(SPOTIFY_SEARCH_URL, params=params, headers=headers)
        search_resp.raise_for_status()
        tracks = search_resp.json().get("tracks", {}).get("items", [])

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
            artists_resp = await client.get(
                SPOTIFY_ARTISTS_URL,
                params={"ids": ",".join(artist_ids[:50])},
                headers=headers,
            )
            artists_resp.raise_for_status()
            for artist in artists_resp.json().get("artists", []) or []:
                genres = artist.get("genres") or []
                genres_by_artist_id[artist.get("id")] = genres[0] if genres else None

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
