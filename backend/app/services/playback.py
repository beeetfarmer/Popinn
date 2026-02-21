def is_counted_view(
    watched_seconds: int | float,
    video_duration_seconds: int | None,
    threshold_ratio: float,
) -> bool:
    if video_duration_seconds is None or video_duration_seconds <= 0:
        return False
    watched = float(watched_seconds or 0)
    threshold = max(0.0, min(1.0, threshold_ratio))
    return watched >= (video_duration_seconds * threshold)
