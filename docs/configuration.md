# Configuration

Popinn is configured in two places.

**Environment variables** live in `.env`, are read at startup, and require a
restart to change. Anything security-relevant is here.

**Runtime settings** live in the database, are edited from the settings page,
and take effect immediately.

- [Required](#required)
- [Paths and storage](#paths-and-storage)
- [Networking and cookies](#networking-and-cookies)
- [Authentication](#authentication)
- [Background work](#background-work)
- [Stream tokens](#stream-tokens)
- [Rate limits](#rate-limits)
- [External metadata](#external-metadata)
- [Upload limits](#upload-limits)
- [Container settings](#container-settings)
- [Runtime settings](#runtime-settings)

---

## Required

| Variable | Description |
| --- | --- |
| `SECRET_KEY` | Signs every JWT. Must be long and random. Changing it invalidates all sessions immediately. |
| `POSTGRES_PASSWORD` | Database password. Must be changed from the example value. |

Generate both with:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

---

## Paths and storage

| Variable | Default | Description |
| --- | --- | --- |
| `POPINN_MEDIA_PATH` | `./media` | Host path to your videos. Mounted read-only. |
| `POPINN_APPDATA_PATH` | `./app-data` | Host path for generated files. Must be writable. |
| `MEDIA_PATH` | `/media` | Path *inside* the container. Rarely changed. |
| `APP_DATA_PATH` | `/app-data` | Path *inside* the container. Rarely changed. |
| `THUMBNAIL_DIR` | `.thumbnails` | Subdirectory of app data |
| `PREVIEW_DIR` | `.previews` | Subdirectory of app data |
| `HLS_DIR` | `.hls` | Subdirectory of app data |
| `APP_DATA_PUBLIC_SUBDIRS` | `.thumbnails,.previews,.hls,.artist-images,.user-images` | Allow-list of app-data subdirectories the `/data` route will serve. Anything not listed is unreachable over HTTP. |

`APP_DATA_PUBLIC_SUBDIRS` is a security control, not a convenience setting.
Widening it exposes those directories to any authenticated user.

---

## Networking and cookies

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,backend,web` | Comma-separated `Host` allow-list. A request with any other `Host` is rejected. Add your public hostname here. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | CORS origins allowed to call the API with credentials |
| `COOKIE_SECURE` | `true` | Marks session cookies `Secure`. Set `false` only for plain-HTTP LAN use, otherwise browsers discard the cookie and login fails. |
| `COOKIE_SAMESITE` | `lax` | `SameSite` policy for session cookies |
| `COOKIE_DOMAIN` | unset | Set only if you serve the UI and API from different subdomains |
| `WEB_PORT` | `8080` | Host port the web container binds |

The three cookie names (`ACCESS_COOKIE_NAME`, `REFRESH_COOKIE_NAME`,
`CSRF_COOKIE_NAME`) can be overridden but rarely need to be.

---

## Authentication

| Variable | Default | Description |
| --- | --- | --- |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | Whether anyone can create an account. Enable it long enough to make your first (admin) account, then turn it off. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Access-token lifetime, in minutes |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh-token lifetime, in days |
| `ALLOW_RUNTIME_PATH_CHANGES` | `false` | Whether the media and app-data paths may be changed from the settings UI. Leave off: it lets an administrator point the scanner at arbitrary paths inside the container. |

---

## Background work

| Variable | Default | Description |
| --- | --- | --- |
| `BACKGROUND_WORKERS` | `2` (`4` in the example env) | Size of the background job pool. Scans, thumbnail generation and HLS transcodes all draw from it. |
| `VIEW_THRESHOLD_RATIO` | `0.2` | Fraction of a video that must be watched before it counts as a view |

An HLS transcode can occupy a worker for minutes. With only one or two workers,
a batch of transcodes will starve quick interactive jobs such as a metadata
refresh. Four is a reasonable default — but see
[Resource limits](installation.md#resource-limits), because memory and CPU need
to scale alongside it.

---

## Stream tokens

By default, media is protected by your session cookie. Stream tokens add a
short-lived signed token to media URLs, so a leaked URL stops working quickly.

| Variable | Default | Description |
| --- | --- | --- |
| `STREAM_TOKENIZATION_ENABLED` | `false` | Append a signed `st=` token to media URLs |
| `STREAM_TOKEN_REQUIRED` | `false` | Reject media requests that lack a valid token |
| `STREAM_TOKEN_TTL_SECONDS` | `21600` | Token lifetime (6 hours). Minimum 60. |

Enable tokenization first and confirm playback still works, then turn on
`STREAM_TOKEN_REQUIRED`. Turning both on at once makes a misconfiguration look
like total playback failure.

Tokens are bound to both the user and the exact resource path, so one cannot be
replayed against a different file.

---

## Rate limits

All values use the form `<count>/<period>`, for example `45/minute`.

| Variable | Default |
| --- | --- |
| `RATE_LIMIT_DEFAULT` | `120/minute` |
| `RATE_LIMIT_AUTH` | `10/minute` |
| `RATE_LIMIT_SCAN` | `5/minute` |
| `RATE_LIMIT_SPOTIFY_SEARCH` | `45/minute` |
| `RATE_LIMIT_LASTFM_SEARCH` | `45/minute` |
| `RATE_LIMIT_ARTIST_METADATA_REFRESH` | `20/minute` |
| `RATE_LIMIT_PLAY_EVENT` | `240/minute` |
| `RATE_LIMIT_SETTINGS_IMPORT` | `6/minute` |

Counters are stored in the database rather than in process memory, so limits
hold across restarts and across multiple backend replicas.

Separately, `SPOTIFY_API_RATE_LIMIT` (`10/second`) and `LASTFM_API_RATE_LIMIT`
(`5/second`) throttle Popinn's *outbound* calls so you do not get banned by
those services. `EXTERNAL_API_MAX_RETRIES` (`2`) and
`EXTERNAL_API_RETRY_BACKOFF_SECONDS` (`0.5`) control retries.

---

## External metadata

Both integrations are optional; Popinn works fine without them, you just get no
artist biographies or artwork.

| Variable | Description |
| --- | --- |
| `LASTFM_API_KEY` | Artist biographies and images. Free key from <https://www.last.fm/api/account/create>. |
| `LASTFM_CACHE_TTL_HOURS` | How long artist metadata is cached before it is eligible for refresh. Default `168` (one week). |
| `SPOTIFY_CLIENT_ID` | Track metadata lookup |
| `SPOTIFY_CLIENT_SECRET` | Track metadata lookup. Credentials from <https://developer.spotify.com/dashboard>. |

---

## Upload limits

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_IMAGE_UPLOAD_BYTES` | 5 MB | Artist and profile images |
| `MAX_SUBTITLE_FILE_BYTES` | 2 MB | Uploaded subtitle files |
| `MAX_SETTINGS_IMPORT_BYTES` | 10 MB | Settings import payloads |

---

## Container settings

| Variable | Default | Description |
| --- | --- | --- |
| `TAG` | `latest` | Image tag to run. Pin to `0.1.0` for an exact release, or `0.1` to track patches. |
| `POPINN_BACKEND_MEMORY` | `4g` | Backend memory ceiling |
| `POPINN_BACKEND_CPUS` | `4` | Backend CPU allowance |
| `POPINN_USERNS` | `keep-id:uid=10001,gid=10001` | User-namespace mapping. **Must be empty for Docker.** See [File permissions](installation.md#file-permissions). |
| `POPINN_ENV_FILE` | `.env` | Which env file compose reads |

---

## Runtime settings

These are stored in the database and changed from **Settings** in the UI. They
apply immediately, with no restart.

| Setting | Description |
| --- | --- |
| `transcoding_enabled` | Whether HLS transcoding may run. **If this is off, formats the browser cannot play natively — such as VP9 in Matroska — will not play at all.** |
| `media_path` | Overrides the media path. Only editable when `ALLOW_RUNTIME_PATH_CHANGES=true`. |
| `app_data_path` | Overrides the app-data path. Same restriction. |
| `view_threshold_ratio` | Overrides `VIEW_THRESHOLD_RATIO` |
| `lastfm_override_local_artist_images` | Whether fetched Last.fm artwork replaces images you uploaded yourself |

On a brand-new install the settings table is empty, which means transcoding is
off. If MKV files load but never play, that is almost always why — turn on
transcoding and re-request the video.
