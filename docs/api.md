# API reference

Base path: `/api/v1`. Interactive documentation is served by FastAPI at
`/docs` on the backend.

- [Authentication](#authentication)
- [Auth and users](#auth-and-users)
- [Videos](#videos)
- [Artists](#artists)
- [Watchlists](#watchlists)
- [Scanning](#scanning)
- [Settings](#settings)
- [Subtitles](#subtitles)
- [Media](#media)
- [Health](#health)
- [Errors](#errors)

---

## Authentication

The API uses **session cookies, not `Authorization` headers**. `POST /auth/login`
sets `popinn_access_token`, `popinn_refresh_token` and `popinn_csrf_token`.

Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must echo the
CSRF cookie in a header. `GET` requests do not need it.

With `curl`, use a cookie jar:

```bash
# Log in and save cookies
curl -c jar.txt -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"me","password":"..."}'

# Authenticated GET
curl -b jar.txt http://localhost:8080/api/v1/videos/

# Authenticated POST: echo the CSRF cookie
CSRF=$(grep popinn_csrf_token jar.txt | awk '{print $7}')
curl -b jar.txt -X POST http://localhost:8080/api/v1/scan/run \
  -H "X-CSRF-Token: $CSRF"
```

A bearer token will **not** work on `/media` or `/data` — those authenticate by
cookie.

Endpoints marked **admin** require the `admin` role.

---

## Auth and users

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account. Requires `ALLOW_PUBLIC_REGISTRATION=true` unless called by an admin. |
| `POST` | `/auth/login` | Log in; sets session cookies |
| `POST` | `/auth/logout` | Log out and revoke the token |
| `POST` | `/auth/refresh` | Exchange the refresh cookie for a new access token |
| `GET` | `/auth/me` | Current user |
| `PATCH` | `/auth/me` | Update your own profile |
| `PUT` | `/auth/me/image` | Upload a profile picture (multipart) |
| `GET` | `/auth/me/plays` | Your play history |
| `GET` | `/auth/users` | **admin** — list users |
| `DELETE` | `/auth/users/{user_id}` | **admin** — delete a user |

---

## Videos

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/videos/` | List videos. Supports filtering, sorting and pagination. |
| `GET` | `/videos/{video_id}` | One video, with artist, subtitles and stream URLs |
| `PATCH` | `/videos/{video_id}` | Edit metadata — title, album, year, genre |
| `DELETE` | `/videos/{video_id}` | Soft-delete. The file is not touched. |
| `POST` | `/videos/bulk-delete` | Soft-delete several at once |
| `GET` | `/videos/{video_id}/recommendations` | Related videos |
| `POST` | `/videos/{video_id}/hls` | Queue an HLS transcode. Returns a job ID; the playlist appears at `/data/.hls/{video_id}/index.m3u8`. |
| `POST` | `/videos/{video_id}/plays` | Record a play event — seconds watched and duration |
| `GET` | `/videos/{video_id}/plays` | Play history for this video |
| `GET` | `/videos/spotify/search` | **admin** — look up track metadata via the active provider (Spotify or MusicBrainz; see `metadata_provider`). Path is kept as `spotify` for compatibility. |
| `GET` | `/videos/transcode/status` | Transcode coverage for the library, plus any run in flight |
| `POST` | `/videos/transcode/run` | **admin** — queue every video that still needs an HLS rendition. `409` if a run is already active. |

Whether a play counts as a view is decided server-side from
`VIEW_THRESHOLD_RATIO`; the client just reports how much was watched.

---

## Artists

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/artists/` | List artists |
| `GET` | `/artists/{artist_id}` | One artist, with videography |
| `PATCH` | `/artists/{artist_id}` | Edit name or biography |
| `DELETE` | `/artists/{artist_id}` | Soft-delete |
| `PUT` | `/artists/{artist_id}/image` | Upload artwork (multipart) |
| `GET` | `/artists/{artist_id}/recommendations` | Similar artists |
| `POST` | `/artists/{artist_id}/refresh-metadata` | Re-fetch from Last.fm |
| `GET` | `/artists/lastfm/search` | Search Last.fm |
| `POST` | `/artists/{artist_id}/lastfm/apply` | Apply a chosen Last.fm match — useful when the folder name is ambiguous |

---

## Watchlists

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/watchlists/` | Your watchlists |
| `POST` | `/watchlists/` | Create one |
| `GET` | `/watchlists/{watchlist_id}` | One watchlist, with items |
| `PATCH` | `/watchlists/{watchlist_id}` | Rename, or add and remove items |
| `DELETE` | `/watchlists/{watchlist_id}` | Delete it |

Watchlists are private to their owner.

---

## Scanning

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/scan/run` | **admin** — start a library scan |
| `GET` | `/scan/jobs` | Scan jobs, newest first |
| `GET` | `/scan/jobs/{job_id}` | One job, with live progress |
| `POST` | `/scan/jobs/{job_id}/cancel` | **admin** — cancel a running scan |
| `POST` | `/scan/artist-metadata/run` | **admin** — refresh artist metadata in bulk |

A job reports `status`, `files_found`, `files_added`, `folders_total`,
`folders_processed`, `current_folder` and any `errors`, which is enough to drive
a progress bar.

---

## Settings

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/settings/` | All settings |
| `PUT` | `/settings/kv/{key}` | **admin** — set one value |
| `GET` | `/settings/runtime` | Effective runtime configuration |
| `PUT` | `/settings/runtime` | **admin** — update runtime settings |
| `GET` | `/settings/view-threshold` | Current view threshold |
| `GET` | `/settings/export` | **admin** — export settings as JSON |
| `POST` | `/settings/import` | **admin** — import settings |
| `POST` | `/settings/thumbnail-regenerate` | **admin** — regenerate all thumbnails |

`media_path` and `app_data_path` are only writable when
`ALLOW_RUNTIME_PATH_CHANGES=true`.

---

## Subtitles

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/videos/{video_id}/subtitles` | Subtitle tracks for a video |
| `GET` | `/subtitles/{subtitle_id}/vtt` | The track as WebVTT |

`.srt` files are converted on the fly, since browsers do not read SubRip.

---

## Media

These sit outside `/api/v1`.

| Path | Serves |
| --- | --- |
| `/media/{path}` | Source video files. Range requests supported. |
| `/data/{path}` | Generated files — thumbnails, previews, HLS output, artwork |

Both require a session cookie. `/data` only exposes the subdirectories listed in
`APP_DATA_PUBLIC_SUBDIRS`. Paths are resolved and confirmed to be inside their
root, so traversal cannot escape.

With stream tokens enabled, URLs returned by the API carry a signed `st=`
parameter bound to the user and that exact path.

---

## Health

| Path | Description |
| --- | --- |
| `/api/v1/health/ready` | Readiness, including database connectivity. Used by the container healthcheck. |

---

## Errors

Errors are JSON with a `detail` field:

```json
{ "detail": "Video not found" }
```

| Status | Meaning |
| --- | --- |
| `400` | Malformed request |
| `401` | Missing, expired or invalid session |
| `403` | Authenticated but not permitted — usually an admin-only endpoint, or a missing CSRF header |
| `404` | Not found, or soft-deleted |
| `413` | Upload exceeded its size limit |
| `422` | Validation failed; `detail` lists the offending fields |
| `429` | Rate limited |
