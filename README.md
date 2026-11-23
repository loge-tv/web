# Loge for the browser

The web version of Loge: a custom Plex client that skips intros and credits using data from Loge Server
from [loge-tv/server](https://github.com/loge-tv/server). React + TypeScript + Vite, a static build with no backend.
Works on a computer and is adapted for phones. The reference for behaviour is the
Apple TV app; the logic of skipping, track selection and moving between
episodes is ported from SkipTVKit together with its tests.

## What it does

The interface is in Russian for now; the labels in quotes below are English translations.

- **Sign-in** with a Plex account: a PIN (`plex.tv/api/v2/pins`, strong) → the
  `app.plex.tv/auth` page → return to `forwardUrl` → polling the PIN (up to 90 s). The server list
  comes from `plex.tv/api/v2/resources`, the addresses are checked in parallel (`/identity`), and the
  most preferred one that answers is used (local → remote → relay). On an HTTPS page only
  HTTPS addresses (plex.direct) are used, otherwise the browser blocks mixed content. The token is
  kept in `localStorage`.
- **Home**: "Continue Watching" (onDeck: started items first by `lastViewedAt`, then
  the next episodes of shows in progress — the show watched last comes first; its
  `lastViewedAt` comes from one request, `/library/metadata/a,b,c`, without it the Plex order is kept), "Recently Added · \<library>" — new episodes
  collapse into one season card. An episode card opens its season with that episode;
  the ▶ button over the artwork (on hover, always on a phone) plays it right away.
- **Libraries** of movies and shows with "All / Unwatched / New" filters. A movie
  page, a show page with seasons and episodes. The selected episode: the started one, otherwise
  the first unwatched one after the last watched, otherwise the first. "Watched / Unwatched"
  marks.
- **Player**:
  - Direct play in `<video>` if the browser supports the container and codecs (MP4/M4V/MOV/WebM +
    `canPlayType`) and the chosen dub is the one the browser plays by default (in Safari
    the track can be switched through `audioTracks`). Otherwise the Plex universal transcoder
    (`/video/:/transcode/universal/start.m3u8`, HLS through hls.js, natively in Safari) with
    `directStream=1`, `directStreamAudio=1`: H.264 video is copied, everything else
    is re-encoded. If direct play fails after all, the player switches
    to the transcoder automatically.
  - Outside the home network (an address that is not among the server's local connections) the file for
    direct play is served by Loge Server (`/v1/files`, the token in the query: `<video>` sends no
    headers): there Plex without Plex Pass answers the file itself with 403 "Downloading requires a
    Remote Watch Pass or Plex Pass". If Loge Server didn't serve the file — direct play from Plex,
    then the transcoder. The Plex transcoder from outside without Plex Pass is most likely closed too
    (not tested), so an MKV away from home may not play in the browser.
  - Audio and subtitles: the TrackSelector rules (Russian audio; with it only forced Russian
    subtitles, otherwise full Russian ones). A dub chosen by hand is
    remembered for the show. Text subtitles (SRT/VTT/ASS) are taken from
    `/library/streams/{id}` (UTF-8 or Windows-1251) and drawn over the video by file
    time; image-based ones (PGS/VobSub) and the ones Plex didn't serve are burned in by the transcoder.
  - Progress in Plex: `/:/timeline` every 10 s, on pause and stop; "watched" is set when
    the final credits start or at 90 %. A started item plays right away from where it was left,
    without asking; "Start over" is a button on the movie page.
  - Keys: Space (and K) pause, ← / → seek (the step is in settings, 5 / 5 s by
    default), F goes full screen, M toggles sound, Esc closes the panel / card / countdown,
    then exits the player.
  - Seeking by dragging (mouse and finger) with a preview frame from the Plex BIF
    (`/library/parts/{id}/indexes/sd`, if the file has `indexes="sd"`), otherwise just the time.
- **Skipping** — "Automatic / With countdown (default) / With a button / Off" modes with the same
  SkipController logic as on Apple TV. Final credits → a "Next episode
  in N" card with "Play" and "Credits" buttons; in countdown mode, "Don't skip";
  seeking back before the intro skips it again.
- **Show timing** in the player (the tracks button): shifts the start and end of the intro and
  credits by any number of seconds, applied at once. The adjustment and the dub are stored in
  `localStorage` and synced with Loge Server (`/v1/preferences/{showRatingKey}`) in the same JSON as
  Apple TV; unsaved changes are not overwritten by data from Loge Server; when Loge Server
  is unreachable the local copy works and is sent later.
- **Settings**: skip mode, autoplay of the next episode and a 5/10/15 s countdown, seek
  steps, the Loge Server address (with a check and a reset), "Always through the server"
  (forced transcoding), server and connection address, switching servers, sign out.
- Loge Server is optional: if it doesn't answer, the video just plays without skipping.

## Running

You need Node 20+.

```sh
git clone https://github.com/loge-tv/web.git
cd web
npm ci
npm run dev          # http://localhost:5173, real plex.tv
npm test             # Vitest: logic from src/core (ported SkipTVKit tests + web)
npm run lint         # tsc + ESLint
npm run build        # dist/ — static files
```

### Without a real Plex

`dev/fake-server.mjs` is a fake plex.tv (PIN, sign-in page, server list), Plex Media
Server (libraries, metadata, timeline/scrobble, files with Range, BIF, SRT in cp1251,
an ffmpeg HLS transcoder) and Loge Server (segments, preferences, CORS). The video is generated by
ffmpeg into `dev/.media` (not in git).

```sh
npm run build:fake && npm run fake   # the app at http://127.0.0.1:5180
npm run dev:fake                     # or the Vite dev server against the fakes (fake must be running too)
npm run smoke                        # build + headless Chrome + checks, screenshots in dev/.out/screens
FAKE_HLS=absolute npm run smoke      # HLS timeline from the start of the file instead of "from offset"
```

The smoke test uses the installed Google Chrome (`CHROME_PATH` for another path) and
`ffmpeg` from PATH. It goes through: PIN sign-in → home (order, collapsing) → an episode from
"Continue Watching" → direct play of MP4 with SRT in cp1251 → automatic intro skip → BIF preview →
the timing adjustment goes to Loge Server → timeline → the next episode card and scrobble on
the credits → autoplay of the next episode (MKV → HLS, resuming from 0:40) → seeking back before
the offset restarts the transcoder → switching the dub (PUT streams, restart, the dub stored in
Loge Server) → Esc (stopped, transcode stopped) → choosing the started episode → movie: resume
dialog, marking as watched, filters → settings → countdown mode ("Don't
skip", the button inside the intro) → Loge Server off → keys → leaving the player while
it is still loading (nothing starts, no transcode is left behind) → the phone layout without
horizontal scrolling.

## Deployment

`npm run build` → `dist/`. Paths are relative (`base: './'`), routing goes through `#`,
so any static hosting and any subdirectory works (GitHub Pages, nginx, S3, …),
without rewrite rules.

- **HTTPS is required** (or `http://localhost`): from an HTTPS page only the server's HTTPS
  addresses are reachable — `*.plex.direct` from the plex.tv list. If the page is opened over HTTP
  on the local network, `http://192.168.…:32400` works too.
- The default Loge Server address is `https://loge-server.example.com`; it can be changed in
  settings or at build time: `VITE_DETECTOR_URL=https://… npm run build`. Loge Server must
  send CORS headers (see below) and be on HTTPS if the app itself is on HTTPS.
- `VITE_PLEX_TV_URL`, `VITE_PLEX_AUTH_URL` — for the fakes only.
- The app name is a single constant, `APP_NAME` in `src/config.ts` (and `<title>` in
  `index.html`).

## What Loge Server needs to provide

Every request to Loge Server carries the `X-Plex-Token` header, so the browser first sends a
preflight `OPTIONS`. Loge Server sends CORS headers since version 0.1.9 (in `main`); checked on
`https://loge-server.example.com`: the preflight gets 204 with the headers below. Without CORS
(an old or a custom Loge Server) the video plays without segments, and a show's timing and dub live
only in `localStorage`.

- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, PUT, OPTIONS`,
  `Access-Control-Allow-Headers: X-Plex-Token, Content-Type, Accept`, an answer to the preflight
  `OPTIONS` without a token check. Requests: `GET /v1/segments/{ratingKey}`,
  `GET/PUT /v1/preferences/{key}`, `GET /healthz`; the `X-Plex-Token` header is the access token
  for the Plex server (as on Apple TV).
- No other API changes are needed.

## Layout

```
src/core/      pure logic without the DOM: Plex models, plex.tv/PMS/Loge Server clients,
               SkipPolicy/SkipController, adjustment, show preferences and their sync,
               track selection, playback plan, BIF, subtitles. Tests are in src/core/__tests__
src/app/       session state (sign-in, server, connection), loading and navigation hooks
src/player/    PlayerSession (engine: <video>/hls.js, file time, skipping, progress,
               next episode), PlayerPage, ScrubBar, TracksPanel
src/pages/     home, libraries, movie, show, settings, sign-in screens
src/ui/        cards, shelves, icons, shared layout
dev/           fake servers and the smoke test
```

## Decisions

- **Plex auth goes in the query** (`X-Plex-Token`, `X-Plex-Client-Identifier` and so on), not in
  headers: that way GETs to plex.tv and PMS are "simple" CORS requests without a preflight, and the same
  URLs work in `<video src>` and `<img src>`. The only header is `Accept`.
  The exception is the track selection PUT (`/library/parts/{id}`), which has a preflight.
- **Sign-in by redirect**, not a popup: popups are blocked on phones. The PIN
  is saved before leaving and waits for the token after the return.
- **Direct play only for MP4/M4V/MOV/WebM.** Browsers don't open MKV, so it goes straight to the
  transcoder (the video is usually copied then). HEVC plays directly only where `canPlayType`
  confirms it (Safari, some Chrome/Edge); in HLS it is always re-encoded to H.264.
- **Transcoder profile**: the request gets
  `X-Plex-Client-Profile-Extra=add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,mp3&replace=true)`
  — what hls.js and Safari are sure to play.
- **File time under HLS.** The transcode starts at `offset`; before starting hls.js the player
  reads the media playlist itself and decides by its length whether the stream counts time from the
  start of the file or from the offset (`file time = currentTime + offset`). Seeking beyond what the
  transcoder serves restarts it from the new position (with a 400 ms delay, so that a series of ←
  presses gives one restart). All positions for skipping, progress and subtitles are in file time.
- **Subtitles are drawn by a layer of our own**, not `<track>`: that way they work the same in direct
  play and in HLS with an offset, and understand ASS and cp1251. Forced ones are detected both by the
  flag and by the word "forced/форс" in the title.
- **Stopping during the final credits** sends the end of the file to the timeline, not the position:
  otherwise Plex would keep "Resume from 41:10" on an episode it has just marked watched
  (credits start before 90 %). This differs from Apple TV (which sends the position) and relies
  on the PMS rule "after 90 % it's watched, with no resume point", which has been checked only
  against the fake. The cost: if you stop in the credits to finish them later, there will be no
  resume point.
- **hls.js is loaded lazily** — only when the transcoder is needed (it's most of the bundle).
- **The season card** in "Recently Added" — one per season, ordered by the newest episode.
- The **"Always through the server"** setting is for files the browser claims to
  support but plays badly.

## Known limitations and what's not tested

Tested only against the fakes (`npm run smoke`, Chrome 157, macOS) and with unit tests.
It has not been run against a real Plex Media Server and plex.tv. In the smoke test seeking is
hovering and clicking on the bar; dragging and touch, Safari and Firefox were not run. Not tested:

- CORS on a real PMS (including the preflight of PUT `/library/parts/{id}`). Plex Web works
  cross-origin, so the headers are expected to be there. On plex.tv it was checked with curl
  (2026-11-22): the preflight and POST `/api/v2/pins`, and the preflight of `/api/v2/resources` answer
  with `Access-Control-Allow-Origin: *` and allow the `X-Plex-*` headers.
- The behaviour of the real transcoder: whether it accepts `X-Plex-Client-Profile-Extra` and
  the `X-Plex-Platform=Chrome/Safari/…` profile, what the playlist looks like with `offset` (from the
  start of the file or from the offset — the player handles both), whether segments need the token
  (it is always passed), burning in subtitles with `subtitles=burn`.
- Whether PMS serves embedded (not external) text subtitles through `/library/streams/{id}`.
  If not, they are burned in by the transcoder (slower, no switching on the fly).
- Chrome 142+ (Local Network Access): a page from the internet that talks to a plex.direct
  address with a local IP triggers a permission prompt for access to devices on the local
  network — it has to be allowed once.
- Safari: native HLS and `audioTracks` switching are written but have not been run.
- Firefox: no HEVC and no AC3/EAC3 — such files go through the transcoder.
- Dolby Vision / HDR are not played as is in the browser: Plex re-encodes them (with
  tone mapping, if the server can), and only what `canPlayType` confirms plays directly.
- DTS/TrueHD — the audio is always re-encoded.
- Missing: Plex managed users (Plex Home), playlists, search, a PiP button,
  quality selection (always the maximum, `videoQuality=100`).
- Autoplay: if the browser doesn't allow starting the video without a gesture, a large
  ▶ button is shown.

## License

MIT, see [LICENSE](LICENSE).
