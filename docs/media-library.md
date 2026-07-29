# Media library

How Popinn expects your files to be arranged, and what it does with them.

- [Folder layout](#folder-layout)
- [File naming](#file-naming)
- [Supported formats](#supported-formats)
- [Subtitles](#subtitles)
- [What a scan does](#what-a-scan-does)
- [Rescanning](#rescanning)
- [Generated files](#generated-files)
- [Transcoding](#transcoding)
- [Deleting things](#deleting-things)

---

## Folder layout

**The top level of your media folder is the artist list.** Every directory
directly inside it becomes an artist, named after the folder.

Two layouts are supported, and you can mix them freely — even within a single
artist.

**Flat** — one file per track:

```
music-videos/
├── Daft Punk/
│   ├── Around the World.mkv
│   └── One More Time.mp4
└── Gorillaz/
    └── Feel Good Inc.mkv
```

**Nested** — each track gets its own folder, which keeps sidecar files tidy:

```
music-videos/
└── Daft Punk/
    ├── Around the World/
    │   ├── Around the World.mkv
    │   ├── Around the World.en.srt
    │   └── folder.jpg
    └── One More Time/
        └── One More Time.mp4
```

The scan descends **exactly one level** below each artist folder. That is
deliberate: it lets nested libraries work without the scanner wandering into
unrelated directory trees. A video three levels deep will not be found.

Directories whose name starts with `.` are skipped, which is how Popinn's own
generated folders stay out of the way.

---

## File naming

The filename becomes the video title, minus the extension.

If the filename repeats the artist name as a prefix, it is stripped:

| File | Artist | Resulting title |
| --- | --- | --- |
| `Daft Punk/Around the World.mkv` | Daft Punk | Around the World |
| `Daft Punk/Daft Punk - Around the World.mkv` | Daft Punk | Around the World |
| `Daft Punk/Some Other Band - Track.mkv` | Daft Punk | Some Other Band - Track |

The prefix is only removed when it actually matches the artist folder, so a
title that legitimately contains " - " survives intact.

Titles are editable in the UI afterwards, and your edits survive rescans.

---

## Supported formats

**Video:** `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`

Being scannable is not the same as being playable in a browser. An `.mkv`
containing H.264 usually plays directly; one containing VP9 or older codecs
does not, and needs [transcoding](#transcoding).

**Subtitles:** `.srt`, `.vtt`

---

## Subtitles

Place subtitle files next to the video, sharing its name:

```
Around the World.mkv
Around the World.srt
Around the World.en.srt
```

The segment between the video name and the extension is treated as a language
code. `.srt` files are converted to WebVTT when served, since browsers do not
read SubRip natively.

In the nested layout, subtitles are picked up from the track folder. In the
flat layout, from the artist folder.

---

## What a scan does

Start one from **Settings → Scan Library**. For each artist folder:

1. **Find or create the artist** from the folder name
2. **Enumerate video files**, in both layouts
3. **Insert new videos** — files already in the database are skipped, matched by
   their path
4. **Extract metadata** with `ffprobe`: duration and file size
5. **Generate a thumbnail** with `ffmpeg`, from five seconds in
6. **Generate a preview clip** — ten silent, low-bitrate seconds for hover
   previews in the UI
7. **Attach subtitles** found alongside the video
8. **Queue artist metadata** for Last.fm enrichment, if a key is configured

Steps 4–7 run in the background worker pool, so the scan itself finishes long
before every thumbnail exists. Videos appear in the library immediately and
gain artwork as the workers catch up.

Progress — including the folder currently being processed — is reported live,
and a running scan can be cancelled.

---

## Rescanning

Rescanning is incremental and safe to run as often as you like. Videos are
matched by file path, so:

- **New files** are added
- **Unchanged files** are left alone, with metadata edits preserved
- **Moved or renamed files** are treated as a new video, and the old entry
  remains until you delete it
- **Deleted files** are *not* removed automatically — the database entry stays
  until you delete it in the UI

Because matching is by path, reorganising your library will produce duplicates.
Do the reorganising first, then scan.

---

## Generated files

Everything Popinn creates lands under app data, never in your media folder:

| Directory | Contents |
| --- | --- |
| `.thumbnails/` | One JPEG per video |
| `.previews/` | Ten-second muted clips, scaled to 360p |
| `.hls/<video-uuid>/` | `index.m3u8` plus six-second `.ts` segments |
| `.artist-images/` | Artist artwork, uploaded or fetched |
| `.user-images/` | Profile pictures |

Your media folder is mounted read-only, so this separation is enforced by the
container, not merely by convention.

---

## Transcoding

Browsers only play a narrow set of codecs. A `.mkv` holding VP9 will load and
then sit there doing nothing in Chrome and Firefox. Popinn's answer is
on-demand HLS: `ffmpeg` re-encodes to H.264 and serves the result as a
segmented playlist.

**Transcoding must be enabled** in **Settings** first — it is off on a fresh
install, and that is the usual explanation for "my MKVs will not play".

Once enabled, requesting playback of an unplayable file queues an HLS job. The
first request takes as long as the transcode does; afterwards the output is
cached in `.hls/` and playback is instant.

The encoder is deliberately constrained:

| Setting | Value | Why |
| --- | --- | --- |
| Resolution | capped at 1080p | Without a cap a 4K master is re-encoded at 4K, and one job can hold ~2.7 GB |
| Threads | 4 per job | libx264 otherwise defaults to ~1.5× your core count, and each thread carries its own lookahead buffers |
| Preset | `veryfast`, CRF 23 | Sensible quality-to-time ratio for a library you are transcoding in bulk |
| Segments | 6 seconds | Standard HLS granularity |
| Timeout | 8x the source duration (min 10 min, max 2 h) | Bounds a stuck ffmpeg without truncating long videos. A flat ceiling is not safe here: concurrent encodes contend for the same cores, so each runs several times slower than it would alone. |

A transcode that fails or times out has its output deleted rather than left in
place. This matters more than it sounds: a partial playlist has no
`#EXT-X-ENDLIST`, which makes players treat it as a *live* stream — no seek bar,
and playback starting part-way through — and because the file existed, nothing
would ever regenerate it. Popinn only serves a playlist once it is complete.

### Bulk transcoding

**Settings → Transcoding** shows how many videos need an HLS rendition, how many
have one, and how many are still pending, with a button to transcode everything
outstanding. A progress bar tracks the run while it is going.

---

## Deleting things

Deletion is **soft**. Removing a video or artist in the UI sets a deletion
timestamp on the database row; the file on disk is untouched, and cannot be
touched, because the media mount is read-only.

The practical consequence is that deleting something and then rescanning brings
it back — the file is still there, and the scanner still finds it. To remove
something permanently, delete the file from your media folder first, then
delete the entry in Popinn.
