import os
from pathlib import Path


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
) -> str | None:
    if not abs_path_or_url:
        return None
    if is_external_url(abs_path_or_url):
        return abs_path_or_url

    candidate = Path(abs_path_or_url).resolve(strict=False)
    media_root_path = Path(media_root).resolve(strict=False)
    app_data_root_path = Path(app_data_root).resolve(strict=False)

    for root_path, public_prefix in (
        (media_root_path, "/media"),
        (app_data_root_path, "/data"),
    ):
        try:
            rel = candidate.relative_to(root_path)
        except ValueError:
            continue

        url = f"{public_prefix}/{rel.as_posix()}"
        if cache_bust:
            try:
                mtime = int(os.path.getmtime(abs_path_or_url))
                url += f"?v={mtime}"
            except OSError:
                pass
        return url

    return None
