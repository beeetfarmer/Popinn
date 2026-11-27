"""Artist bios from Wikipedia (free, keyless; text is CC BY-SA 4.0)."""

import re
from urllib.parse import quote, unquote, urlparse

from app.services.lastfm import _request_json_with_retries, normalize_for_match

WIKIPEDIA_ATTRIBUTION_LINE = "Biography from Wikipedia, licensed under CC BY-SA 4.0"
WIKIPEDIA_LINK_PREFIX = "Wikipedia:"
BIO_PARAGRAPHS = 2
# Wikimedia rejects requests without a descriptive User-Agent.
_HEADERS = {"User-Agent": "Popinn/1.0 (self-hosted music video library)"}
_HOST_RE = re.compile(r"^([a-z][a-z0-9-]*)(?:\.m)?\.wikipedia\.org$")
# Wikidata short descriptions of musicians: "South Korean girl group",
# "American singer-songwriter", "English rock band", ...
_MUSIC_DESCRIPTION_RE = re.compile(
    r"\b(singer|band|musician|rapper|group|duo|trio|dj|composer|songwriter|"
    r"producer|vocalist|guitarist|pianist|drummer|idol|orchestra|ensemble|music)\b",
    re.IGNORECASE,
)


def parse_wikipedia_url(url: str) -> tuple[str, str] | None:
    """(language, title) from an article URL, or None if it is not one."""
    candidate = (url or "").strip()
    if "//" not in candidate:
        candidate = f"https://{candidate}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    match = _HOST_RE.match((parsed.hostname or "").lower())
    if parsed.scheme not in {"http", "https"} or not match:
        return None
    if not parsed.path.startswith("/wiki/"):
        return None
    title = unquote(parsed.path[len("/wiki/"):]).replace("_", " ").strip()
    if not title or ":" in title:  # Special:, File:, Talk: ... are not articles
        return None
    return match.group(1), title


def build_wikipedia_url(lang: str, title: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/{quote(title.replace(' ', '_'), safe='()_,')}"


def _api(lang: str, params: dict, context: str) -> dict | None:
    return _request_json_with_retries(
        url=f"https://{lang}.wikipedia.org/w/api.php",
        params={"format": "json", "formatversion": 2, **params},
        timeout_seconds=15,
        rate_bucket="wikipedia_api",
        context=context,
        headers=_HEADERS,
    )


def search_articles(query: str, *, limit: int = 10, lang: str = "en") -> list[dict]:
    data = _api(
        lang,
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrnamespace": 0,
            "gsrlimit": max(1, min(limit, 20)),
            "prop": "description|pageimages",
            "piprop": "thumbnail",
            "pithumbsize": 160,
        },
        f"Wikipedia search ({query})",
    )
    pages = ((data or {}).get("query") or {}).get("pages") or []
    pages = sorted((p for p in pages if isinstance(p, dict) and p.get("title")), key=lambda p: p.get("index", 0))
    return [
        {
            "title": page["title"],
            "description": page.get("description"),
            "thumbnail_url": (page.get("thumbnail") or {}).get("source"),
            "url": build_wikipedia_url(lang, page["title"]),
        }
        for page in pages
    ]


def find_article_url(artist_name: str) -> str | None:
    """Best guess at the artist's article, or None rather than a wrong one.

    Accepts a result only if its title, minus any "(group)"-style qualifier,
    is the artist name and its short description reads like a musician.
    """
    target = normalize_for_match(artist_name)
    if not target:
        return None
    for item in search_articles(artist_name, limit=10):
        base_title = re.sub(r"\s*\([^)]*\)\s*$", "", item["title"])
        if normalize_for_match(base_title) == target and _MUSIC_DESCRIPTION_RE.search(item.get("description") or ""):
            return item["url"]
    return None


def fetch_article(url: str) -> dict | None:
    """First paragraphs of the article intro plus its lead image.

    Returns {"bio", "image_url", "url"} with the bio carrying the required
    attribution, or None for a missing or disambiguation page.
    """
    parsed = parse_wikipedia_url(url)
    if not parsed:
        return None
    lang, title = parsed
    data = _api(
        lang,
        {
            "action": "query",
            "titles": title,
            "redirects": 1,
            "prop": "extracts|pageimages|pageprops",
            "exintro": 1,
            "explaintext": 1,
            # A scaled copy: originals can be tens of megabytes.
            "piprop": "thumbnail",
            "pithumbsize": 1000,
            "ppprop": "disambiguation",
        },
        f"Wikipedia article ({title})",
    )
    pages = ((data or {}).get("query") or {}).get("pages") or []
    page = pages[0] if pages and isinstance(pages[0], dict) else None
    if not page or page.get("missing") or "disambiguation" in (page.get("pageprops") or {}):
        return None

    paragraphs = [line.strip() for line in (page.get("extract") or "").split("\n") if line.strip()]
    canonical_url = build_wikipedia_url(lang, page.get("title") or title)
    body = "\n\n".join(paragraphs[:BIO_PARAGRAPHS])
    return {
        "bio": add_wikipedia_attribution(body, canonical_url) if body else None,
        "image_url": (page.get("thumbnail") or {}).get("source"),
        "url": canonical_url,
    }


def add_wikipedia_attribution(body: str, url: str) -> str:
    return f"{body.strip()}\n\n{WIKIPEDIA_ATTRIBUTION_LINE}\n{WIKIPEDIA_LINK_PREFIX} {url}"


def is_wikipedia_attributed_bio(text: str | None) -> bool:
    return bool(text) and WIKIPEDIA_ATTRIBUTION_LINE.lower() in text.lower()
