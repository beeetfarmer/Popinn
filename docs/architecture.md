# Architecture

- [Components](#components)
- [Request flow](#request-flow)
- [Data model](#data-model)
- [Authentication](#authentication)
- [Media serving](#media-serving)
- [Background jobs](#background-jobs)
- [Rate limiting](#rate-limiting)
- [Container hardening](#container-hardening)

---

## Components

Three containers, on a private network, with only the web container publishing
a port.

```
                    ┌──────────────────────────┐
    browser ───────▶│  web  (nginx-unprivileged)│  :8080
                    │  serves the built SPA     │
                    │  proxies /api /media /data│
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │  backend  (FastAPI)       │  :8471
                    │  uvicorn + ffmpeg         │
                    │  background worker pool   │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │  db  (PostgreSQL 16)      │  :5432
                    └──────────────────────────┘

  volumes:  media (read-only)  ·  app-data (read-write)  ·  postgres_data
```

| Container | Role |
| --- | --- |
| `web` | Serves the compiled React bundle, proxies `/api/`, `/media/` and `/data/` to the backend. Runs as an unprivileged nginx on port 8080. |
| `backend` | The whole API, the scanner, and the ffmpeg work. Mounts media read-only and app data read-write. |
| `db` | PostgreSQL. Not published to the host; reachable only on the compose network. |

The backend runs migrations at startup (`alembic upgrade head`) before uvicorn
binds, so a fresh database and an upgraded one follow the same path.

---

## Request flow

**Application requests** — the browser calls `/api/v1/...`, nginx proxies to the
backend, FastAPI routes through `app/api/v1/router.py`. Requests pass through
CORS, then `TrustedHostMiddleware` (rejecting unknown `Host` headers), then a
custom middleware that applies security headers.

**Media requests** — `/media/<path>` and `/data/<path>` are handled by the
backend directly rather than served statically, because both need an
authorisation check first. See [Media serving](#media-serving).

---

## Data model

```
users ──┬── watchlists ──── watchlist_items ──┐
        │                                     │
        └── video_plays ──────────────┐       │
                                      │       │
artists ─────── videos ───────────────┴───────┘
                  │
                  └── subtitles
```

| Table | Purpose |
| --- | --- |
| `users` | Accounts. `role` is `user` or `admin`; `is_active` gates login. |
| `artists` | One per media folder. Holds the Last.fm biography, artwork path, and when metadata was last fetched. |
| `videos` | One per file, keyed by a unique `file_path`. Holds title, duration, file size, album, year, genre, and paths to the generated thumbnail and preview. |
| `subtitles` | Sidecar subtitle files, with language and format. |
| `watchlists` / `watchlist_items` | Per-user collections. |
| `video_plays` | Play history: seconds watched, video duration, and whether it crossed the view threshold. |
| `scan_jobs` | Scan status and live progress — folders total and processed, current folder, counts, errors. |
| `settings` | Runtime key/value settings. |
| `revoked_tokens` | Revoked JWT identifiers, held until their natural expiry. |
| `rate_limit_counters` | Rate-limit buckets. |

`artists` and `videos` carry a `deleted_at` column: deletion is soft, so history
and watchlist references survive, and nothing on disk is ever removed.

Primary keys are UUIDs throughout. This matters in one visible way — wiping the
database and rescanning assigns new video IDs, which orphans previously
generated `.hls/<uuid>/` directories.

---

## Authentication

Sessions are cookie-based, not `Authorization` headers.

On login the backend sets three cookies:

| Cookie | Contents | Flags |
| --- | --- | --- |
| `popinn_access_token` | Short-lived JWT carrying user ID and role | `HttpOnly` |
| `popinn_refresh_token` | Longer-lived JWT used to mint new access tokens | `HttpOnly` |
| `popinn_csrf_token` | CSRF value, readable by JavaScript | not `HttpOnly` |

Because the tokens are `HttpOnly`, they are unreachable from JavaScript and so
from XSS. The trade-off is that cookies are sent automatically, which
reintroduces CSRF — hence the third cookie: the frontend reads it and echoes it
in a header on every state-changing request. An attacker's page can cause the
cookie to be *sent*, but cannot *read* it to construct the matching header.

Read-only requests (`GET`) skip the CSRF header; `POST`, `PUT`, `PATCH` and
`DELETE` require it.

The frontend refreshes transparently: a `401` triggers a single refresh attempt,
then replays the original request. Concurrent `401`s share one refresh rather
than stampeding, and a failed refresh surfaces the `401` instead of retrying.

Logout adds the token's identifier to `revoked_tokens`, so an already-issued
token stops working before it expires.

---

## Media serving

Both media routes are authenticated. Neither is a plain static mount.

**`/media/<path>`** serves your source files. The path is resolved and checked
to be inside the media root, so `../` traversal cannot escape it. Range
requests are supported, which is what makes seeking work.

**`/data/<path>`** serves generated files — thumbnails, previews, HLS segments,
artist images. Only the subdirectories listed in `APP_DATA_PUBLIC_SUBDIRS` are
reachable; anything else in app data is invisible over HTTP.

**Stream tokens** (optional, off by default) add a signed `st=` query parameter
to media URLs. The token is bound to both the user and the exact resource path
and expires on `STREAM_TOKEN_TTL_SECONDS`, so a URL copied out of devtools stops
working and cannot be repointed at another file. With
`STREAM_TOKEN_REQUIRED=true`, media requests without a valid token are rejected
outright.

---

## Background jobs

An in-process worker pool sized by `BACKGROUND_WORKERS` handles everything slow:
library scans, metadata extraction, thumbnail and preview generation, HLS
transcoding, and Last.fm enrichment.

The pool is deliberately simple — no Celery, no Redis, no extra container. The
consequence is that **queued work does not survive a restart**. Interrupted
scans are re-runnable and incremental, so in practice you rescan; an interrupted
transcode is simply requested again on the next playback attempt.

The important operational property is that each worker can be holding an
`ffmpeg` process. Memory and CPU limits must scale with the worker count — see
[Resource limits](installation.md#resource-limits).

---

## Rate limiting

Counters live in `rate_limit_counters` in the database, not in process memory.
Limits therefore survive restarts and hold across multiple backend replicas,
rather than resetting whenever a container cycles.

Limits are applied per endpoint class: authentication, scanning, external-API
search, play events and settings import each have their own budget. Popinn's
*outbound* calls to Spotify and Last.fm are throttled separately so a large
scan cannot get you banned upstream.

---

## Container hardening

Applied to every container in the compose files:

| Control | Effect |
| --- | --- |
| `read_only: true` | Root filesystem is immutable; writable paths are explicit tmpfs mounts |
| `cap_drop: ALL` | No Linux capabilities |
| `no-new-privileges` | Processes cannot gain privileges via setuid binaries |
| non-root user | Backend runs as UID 10001, nginx as an unprivileged user |
| `pids_limit` | Caps process count — a fork bomb in ffmpeg cannot take the host down |
| `mem_limit` / `cpus` | Bounded memory and CPU |
| read-only media mount | The application cannot modify your library even if compromised |

The database port is never published to the host, and the backend port is
reachable only through nginx.
