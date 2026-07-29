# Troubleshooting

- [Startup](#startup)
- [Login](#login)
- [Scanning](#scanning)
- [Playback](#playback)
- [Memory and performance](#memory-and-performance)
- [Podman](#podman)
- [Collecting diagnostics](#collecting-diagnostics)

---

## Startup

### Backend restarts in a loop

```bash
docker compose -f docker-compose.yml logs backend --tail=50
```

| Log says | Cause |
| --- | --- |
| `SECRET_KEY ... field required` | `SECRET_KEY` is unset. It has no default, by design. |
| `password authentication failed` | `POSTGRES_PASSWORD` changed after the volume was created. The database keeps the *original* password. Either restore the old value or drop the volume. |
| `connection refused` to `db` | The database has not finished starting. Compose waits for its healthcheck, so a persistent failure means the db container itself is unhealthy — check its logs. |
| `Permission denied` on `/app-data` | See [File permissions](installation.md#file-permissions). |

### `no such file or directory` on the media mount

`POPINN_MEDIA_PATH` must be an absolute path that exists on the host. A relative
path is resolved against the compose file's directory, which is rarely what you
meant.

### Docker refuses to start the backend

If `POPINN_USERNS` is set to `keep-id:...`, Docker rejects it — that syntax is
Podman-only. Set `POPINN_USERNS=` (empty) and `chown` the app-data directory
instead.

---

## Login

### The login form accepts my password but I stay logged out

Almost always the session cookie is being discarded.

Over plain HTTP with `COOKIE_SECURE=true`, the browser refuses to store the
cookie — no error, just no session. Either serve over HTTPS or set
`COOKIE_SECURE=false` for LAN use.

Check the browser devtools **Application → Cookies** panel: if
`popinn_access_token` is absent right after a successful login request, this is
your cause.

### `400 Invalid host header`

Your hostname is not in `ALLOWED_HOSTS`. Add it:

```ini
ALLOWED_HOSTS=popinn.example.com,localhost,127.0.0.1
```

### Everyone was logged out at once

`SECRET_KEY` changed. Every issued token is signed with it, so changing it
invalidates all sessions. This is expected; users just log in again.

### I cannot register

`ALLOW_PUBLIC_REGISTRATION=false` blocks self-registration. Either flip it on
temporarily or have an administrator create the account.

### `403` on actions that should work

A missing CSRF header. This should not happen through the UI, but it will bite
you writing scripts against the API — see [Authentication](api.md#authentication).

---

## Scanning

### The scan finds nothing

The top level of your media folder must be **artist directories**, not video
files. Videos sitting loose at the top level are not picked up.

```
media/                       media/
└── Daft Punk/         vs    └── Around the World.mkv   ← not found
    └── Around the World.mkv
```

### Some videos are missing

- **Too deep.** Scanning descends exactly one level below the artist folder.
  `Artist/Album/Track/video.mkv` is not found.
- **Unsupported extension.** Only `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`.
- **Hidden directory.** Anything starting with `.` is skipped.

### Deleted videos come back after a rescan

Deletion is soft and your media mount is read-only, so the file is still there
and the scanner finds it again. Delete the file from the media folder first,
then delete the entry.

### Renaming files created duplicates

Videos are matched by file path, so a renamed file is a new video. Finish
reorganising, then scan, then delete the stale entries.

### No thumbnails or artist images

If the videos appear but stay imageless, the backend cannot write to app data —
see [File permissions](installation.md#file-permissions). Confirm with:

```bash
docker compose -f docker-compose.yml exec backend touch /app-data/.write-test
```

`Permission denied` means the mapping is wrong.

Missing *artist* images specifically, with thumbnails present, usually just
means `LASTFM_API_KEY` is unset.

---

## Playback

### MKV files load but never play

**The most common problem, and usually not a bug.** Browsers cannot play VP9 or
older codecs inside Matroska. Popinn's answer is HLS transcoding — and
transcoding is **off** on a fresh install, because the settings table starts
empty.

Turn on `transcoding_enabled` in **Settings**, then request the video again. The
first playback waits for the transcode; afterwards it is cached and instant.

### Transcoding is on but playback still fails

Check the playlist exists:

```bash
docker compose -f docker-compose.yml exec backend ls /app-data/.hls/
```

An empty directory means the job never ran or failed. Look for `ffmpeg HLS
failed` in the backend logs — the log line carries the tail of ffmpeg's stderr,
where the real error is.

Long videos can exceed the 300-second per-transcode timeout on slow hardware.

### Seeking does not work

Something in front of Popinn is not passing range requests through. If you have
a reverse proxy, disable response buffering for it — see
[Reverse proxy](installation.md#reverse-proxy-and-https).

### Subtitles do not appear

The file must sit beside the video and share its stem:
`Track.mkv` → `Track.srt` or `Track.en.srt`. Rescan after adding them; they are
attached during a scan, not discovered live.

---

## Memory and performance

### The backend is killed and restarts under load

It hit its memory limit. Confirm:

```bash
docker inspect popinn-backend-1 --format '{{.State.OOMKilled}}'
docker stats --no-stream
```

Memory scales with `BACKGROUND_WORKERS`, because each worker can hold an
`ffmpeg` process. Budget roughly 0.5 GB per worker:

```ini
BACKGROUND_WORKERS=4
POPINN_BACKEND_MEMORY=4g
POPINN_BACKEND_CPUS=4
```

On a small machine, **lower the worker count rather than raising the limit**.
Work takes longer but completes instead of being killed.

Note that raising `mem_limit` alone will not fix an unbounded transcode — it
just moves the ceiling. If you have modified the ffmpeg arguments, check the
resolution cap and thread limit are still there; without them a 4K source is
re-encoded at 4K and a single job can hold ~2.7 GB.

### Transcodes are slow

Transcoding is CPU-bound. Raise `POPINN_BACKEND_CPUS` if the host has spare
cores. Watch for one job finishing in the time four should have — that means
CPU starvation, not a memory problem.

### The UI is slow with a large library

Listing endpoints paginate. If you have proxied the API, make sure query strings
are being forwarded intact.

---

## Podman

### `podman ps` hangs, but `podman inspect` works

Podman Desktop's `podman system service` is holding the libpod database lock.
Container *enumeration* blocks while inspect, logs and run keep working, which
makes it look like a partial failure.

```bash
pkill -f "podman system service"
```

Enumeration recovers immediately.

### A port stays bound after the stack is down

An orphaned container's helper processes survived. Find and kill the
`rootlessport` and `conmon` processes holding the port:

```bash
ss -lptn 'sport = :8080'
```

### Thumbnails fail with `EACCES` under rootless Podman

Set `POPINN_USERNS=keep-id:uid=10001,gid=10001`. Rootless Podman otherwise maps
container UID 10001 to a subordinate UID with no access to your files.

---

## Collecting diagnostics

```bash
# Status, health and restart counts
docker compose -f docker-compose.yml ps

# Recent backend logs
docker compose -f docker-compose.yml logs backend --tail=200

# Resource usage
docker stats --no-stream

# OOM and restart history
docker inspect popinn-backend-1 \
  --format 'OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}}'

# Readiness, including database connectivity
curl -s http://localhost:8080/api/v1/health/ready
```

When reporting a bug, include the backend logs, your `.env` **with
`SECRET_KEY` and `POSTGRES_PASSWORD` removed**, your container runtime and
version, and the layout of a media folder that reproduces the problem.
