"""Artist bio + stored image, taken from sources in the configured priority."""

from app.services import lastfm, wikipedia


def is_fetched_bio(text: str | None) -> bool:
    """True for a bio a source wrote (safe to replace), False for one a person wrote."""
    return lastfm.is_lastfm_attributed_bio(text) or wikipedia.is_wikipedia_attributed_bio(text)


def fetch_artist_metadata(
    artist_name: str,
    *,
    lastfm_name: str | None,
    wikipedia_url: str | None,
    lastfm_api_key: str,
    bio_sources: list[str],
    image_sources: list[str],
) -> dict | None:
    """Return {"bio", "image_url", "lastfm_artist_name", "wikipedia_url"}, or None if nothing was found.

    Each source is fetched at most once, and only when a higher-priority source
    came up empty. "spotify" in image_sources is skipped: Spotify images are
    displayed per request and never stored.
    """
    cache: dict[str, dict | None] = {}

    def source(name: str) -> dict | None:
        if name not in cache:
            if name == "lastfm":
                lookup = (lastfm_name or artist_name).strip()
                cache[name] = lastfm.fetch_artist_info(lookup, lastfm_api_key) if lastfm_api_key else None
            elif name == "wikipedia":
                url = wikipedia_url or wikipedia.find_article_url(artist_name)
                cache[name] = wikipedia.fetch_article(url) if url else None
            elif name == "deezer":
                # The Last.fm canonical name is the better query when known.
                lookup = (lastfm_name or artist_name).strip()
                image_url = lastfm.fetch_deezer_image_url(lookup)
                if not image_url and lookup != artist_name:
                    image_url = lastfm.fetch_deezer_image_url(artist_name)
                cache[name] = {"image_url": image_url}
            else:
                cache[name] = None
        return cache[name]

    bio = next((b for name in bio_sources if (b := (source(name) or {}).get("bio"))), None)
    image_url = next(
        (u for name in image_sources if name != "spotify" and (u := (source(name) or {}).get("image_url"))),
        None,
    )
    lastfm_info = cache.get("lastfm")
    wiki_info = cache.get("wikipedia")
    if not bio and not image_url:
        return None
    return {
        "bio": bio,
        "image_url": image_url,
        "lastfm_artist_name": (lastfm_info or {}).get("artist_name") or lastfm_name,
        "wikipedia_url": (wiki_info or {}).get("url") or wikipedia_url,
    }
