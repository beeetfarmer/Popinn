import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
DEEZER_API_URL = "https://api.deezer.com/search/artist"

# Last.fm returns this hash for every artist that has no real image uploaded.
# It's a 4KB star/placeholder PNG. We must detect and skip it.
LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"


def _fetch_image_from_deezer(artist_name: str) -> str | None:
    """Fetch artist image URL from Deezer as fallback (no auth needed)."""
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(DEEZER_API_URL, params={"q": artist_name})
            resp.raise_for_status()
            data = resp.json()

        results = data.get("data", [])
        if results:
            return results[0].get("picture_xl") or results[0].get("picture_big")
        return None
    except Exception:
        logger.exception("Error fetching Deezer image for %s", artist_name)
        return None


def fetch_artist_info(artist_name: str, api_key: str) -> dict | None:
    """Fetch artist bio and image URL from Last.fm, with Deezer fallback for images."""
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                LASTFM_API_URL,
                params={
                    "method": "artist.getinfo",
                    "artist": artist_name,
                    "api_key": api_key,
                    "format": "json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        artist = data.get("artist")
        if not artist:
            return None

        bio_content = artist.get("bio", {}).get("summary", "")
        # Last.fm wraps links in <a> tags — strip them for clean text
        if bio_content:
            import re
            bio_content = re.sub(r"<a\b[^>]*>.*?</a>", "", bio_content).strip()

        images = artist.get("image", [])
        image_url = ""
        for img in reversed(images):
            url = img.get("#text", "")
            if url and LASTFM_PLACEHOLDER_HASH not in url:
                image_url = url
                break

        # Deezer fallback if Last.fm image is empty or was a placeholder
        if not image_url:
            image_url = _fetch_image_from_deezer(artist_name)

        return {"bio": bio_content or None, "image_url": image_url or None}
    except Exception:
        logger.exception("Error fetching Last.fm info for %s", artist_name)
        return None


def download_artist_image(url: str, save_path: str) -> bool:
    """Download an image from a URL and save it locally."""
    try:
        Path(save_path).parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=30) as client:
            resp = client.get(url)
            resp.raise_for_status()
            Path(save_path).write_bytes(resp.content)
        return True
    except Exception:
        logger.exception("Error downloading artist image from %s", url)
        return False
