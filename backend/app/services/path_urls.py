import os
from pathlib import Path
from typing import Callable


def is_external_url(value: str | None) -> bool:
    if not value:
        return False
    lowered = value.lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def to_public_asset_url(
    abs_path_or_url: str | None,
    *,
    media_root: str,
    app_data_root: str,
    cache_bust: bool = False,
    signer: Callable[[str], str] | None = None,
) -> str | None:
    if not abs_path_or_url:
        return None
    if is_external_url(abs_path_or_url):
        return abs_path_or_url

    # Match on normalised strings first. resolve() stats every path component,
    # and this runs three times per video in every list response: on a network
    # mount (sshfs/NFS) that was ~300ms per video, 8s for a 50-video page. The
    # scanner stores paths under the configured root as written, so a string
    # match is the normal case; resolve() stays as the fallback for anything
    # stored via a different spelling of the root. This only builds a URL --
    # /media and /data still resolve and confine the path when it is served.
    rel = _relative_to_roots(
        Path(os.path.normpath(abs_path_or_url)),
        Path(os.path.normpath(media_root)),
        Path(os.path.normpath(app_data_root)),
    ) or _relative_to_roots(
        Path(abs_path_or_url).resolve(strict=False),
        Path(media_root).resolve(strict=False),
        Path(app_data_root).resolve(strict=False),
    )
    if rel is not None:
        public_prefix, rel_path = rel
        url = f"{public_prefix}/{rel_path.as_posix()}"
        if cache_bust:
            try:
                mtime = int(os.path.getmtime(abs_path_or_url))
                url += f"?v={mtime}"
            except OSError:
                pass
        if signer:
            url = signer(url)
        return url

    return None


def _relative_to_roots(
    candidate: Path, media_root: Path, app_data_root: Path
) -> tuple[str, Path] | None:
    for root, public_prefix in ((media_root, "/media"), (app_data_root, "/data")):
        try:
            return public_prefix, candidate.relative_to(root)
        except ValueError:
            continue
    return None
