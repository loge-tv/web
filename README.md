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
  the ▶ button over the artwork (on hover, always on a phone) plays it right away. There is no
  big card of the last show.
  Recommendations (as in the Apple apps): "Similar on the server" and "Because you watched
  "…"" — from TMDB recommendations through Loge Server (`/v1/recommendations?seeds=movie:1,tv:2`):
  the seeds are the three titles with a TMDB id watched last (the owner's history
  `/status/sessions/history/all`, without it the library's `lastViewedAt`); TMDB titles
  are matched with the Plex catalog (`/library/metadata/matches`, cached in `localStorage` for 30 days,
  "no match" for 7); what is on the server and not started goes to "Similar on the server", the rest
  (minus what Plex history says was watched) makes a shelf per seed. Without a TMDB key on Loge Server
  (404) these shelves are missing, and Settings say so. "More with the cast of "…"" — the Plex catalog's
  "More From This Cast & Crew" for a recent title, works without Loge Server too. They refresh at most
  every 15 minutes and after a deletion.
  Every shelf ("Continue Watching", "Want to watch", "Not out yet", "Recently Added" of
  each library, the three recommendation shelves) can be turned off and moved in Settings →
  "Home and Explore"; "Restore the default order". New shelves take their place after their
  neighbour in the default order. With all of them off, a hint says where to turn them on.
- **Explore** (a link in the header): ready-made collections of the Plex catalog — "Popular on Plex",
  "Most added to watchlists", "Coming soon", "Most anticipated movies"
  (`/hubs/sections/home/<id>`); a season in a collection opens its show. Each collection can be
  turned off and moved in Settings → "Home and Explore", the page shows them in that order;
  with all of them off there is no "Explore" link. Refreshed every 30 minutes.
- **Libraries** of movies and shows with "All / Unwatched / New" filters. A movie
  page, a show page with seasons and episodes. The selected episode: the started one, otherwise
  the first unwatched one after the last watched, otherwise the first. "Watched / Unwatched"
  marks. Posters and pages of downloaded movies and shows carry the "on the Plex watchlist" mark,
  like catalog titles ("In the list" / "Add to the list").
  - **Title pages** (movie, show, catalog title), as in the Apple apps: only the main action is a
    wide button ("Watch", "Continue from …", "Open in the library", or "Add to the list" for a
    catalog title neither on the server nor on the list). The rest are round icons in one row:
    "From the start", watched, the list, the trailer, "⋯". Watched and listed are filled while
    on; each icon's name is its tooltip and accessible name ("In the list — remove from the
    list"). On a phone the main button spans the column.
  - **All seasons and episodes**: the show page takes the show's seasons and the open season's
    episodes from the Plex catalog (`/library/metadata/<key>/children`) and merges them with the
    server's by number. What is not on the server is greyed out, with "Not on the server · 4 January 2025"
    or "Out 15 January 2027" and the account's watched mark (`/userState`). The catalog's episodes
    come after the server's; when they land before the selected one (opened from "Continue
    watching"), the row scrolls back to it. A season watched in full
    has a ✓; a season only in the catalog says "Season 2, not downloaded". An episode that is not
    downloaded can't be played or deleted, only "Mark watched"; a season — "Mark "Season 2" watched"
    (with its episodes). The marks go to Plex on the account (`/actions/scrobble|unscrobble` on
    `metadata.provider.plex.tv`), change at once and roll back with "Couldn't mark" if
    Plex refused. The page of a catalog show that is not on the server shows its seasons and
    episodes the same way; a catalog movie has "Mark watched" ⇄ "Watched". A show
    of an old agent (without a catalog key) is as before.
  - **Deleting downloads** (the "⋯" "More" button): a movie; a show, the open season, all watched
    episodes ("Delete watched episodes (N)": the list is asked from the server again before the question);
    an episode — "Delete episode" under it. Each one after a confirmation in a dialog of the page (not
    `window.confirm`) that says what goes ("3 episodes will be deleted from the server's disk. This
    can't be undone."). Plex deletes: `DELETE /library/metadata/<key>`, one at a time. A refusal is explained:
    only the owner can delete, and Plex Media Server must have "Library → Allow media deletion" on.
    A deleted title leaves the library index at once (and is "Want to watch" again if on the list),
    recommendations are recomputed; after a movie or a show — back.
  - **Trailer** of a movie and a show (downloaded or not): TMDB's YouTube videos through Loge Server
    (`/v1/videos?item=movie:<tmdb>&language=ru`), the preferred language first. The button
    appears when there are videos; it opens a dialog with the embedded YouTube player (`hl` and
    `cc_lang_pref` are the preferred language), a list of the other videos and "Open in YouTube".
    Only real YouTube ids go into the URL. The TMDB id comes from the title's `Guid` (the server gives
    them with `includeGuids=1`, the catalog in its details).
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
  - Audio and subtitles: the TrackSelector rules (audio in the preferred language, Russian by
    default; of several, the best: not a commentary, more channels, a better codec, then
    the default track — 5.1 beats stereo; with it only forced subtitles in that
    language, otherwise full ones). A dub chosen by hand is
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
  SkipController logic as on Apple TV. Before the final credits → a "Next episode
  in N" card with "Play" and "Credits" buttons: the countdown (Settings → Player, 5/10/15 s)
  ends as the credits start, and the next episode starts then. A pause stops the countdown,
  "Credits" (or Esc) cancels it — the credits play with a "Next episode" button; a seek away
  takes the card down and it counts again on return; playback resumed or seeked into the
  credits gets the full countdown, cut at their end. Without "Play automatically" the card
  comes at the credits and waits. In countdown mode, "Don't skip";
  seeking back before the intro skips it again.
- **Show timing** in the player (the tracks button): shifts the start and end of the intro and
  credits by any number of seconds, applied at once. The adjustment and the dub are stored in
  `localStorage` and synced with Loge Server (`/v1/preferences/{showRatingKey}`) in the same JSON as
  Apple TV; unsaved changes are not overwritten by data from Loge Server; when Loge Server
  is unreachable the local copy works and is sent later.
- **Search and the Plex watchlist** (the magnifier in the header): searches the server and the whole Plex
  catalog (Discover, `discover.provider.plex.tv`, 350 ms after typing stops). Results —
  "On the server" (library posters → its page) and "Not on the server" (catalog posters).
  A server title is recognised by its `guid` `plex://movie|show/<catalog key>` (modern Plex agents),
  old agents' titles by type, title (ignoring case and diacritics, ё = е) and year;
  such a title isn't repeated in the catalog part. "On the server" also gets server titles
  whose name matches the query. The bookmark on a catalog poster adds to the Plex watchlist (the
  same one as in the Plex apps) and removes from it. A catalog title page: backdrop, poster, type and year,
  duration or number of seasons, content rating, score, genres, summary, "Add to the
  list" / "In the list", "Open in the library" if the server already has it.
  On Home (after "Continue Watching"; each can be turned off in Settings → Home) and
  in an empty search (always) the watchlist is two shelves: "Want to watch" — out, not on the
  server, not watched by Plex history (`/library/metadata/<keys>/userState`, 50 per request: the
  list itself doesn't have it; a show — if not started); "Not out yet" — nearest first (a date before
  "year only"), undated last, with the release date under the poster. Titles that are on the server
  don't go to these shelves (they are in "Recently Added"); the shelves appear only once both the
  list and the library index are loaded. Empty shelves in search — the hint "Find a movie or show".
  A change of the list shows at once; if Plex refused, it rolls back and a "Plex watchlist" note
  pops up with the reason. Overseerr / Seerr is not needed and affects nothing. The texts are the same as
  in the Apple apps. The catalog uses the plex.tv account token, not the server token; catalog
  pictures go through the Plex resizer `images.plex.tv/photo` (without a token), not straight from
  image.tmdb.org.
- **Settings** — a list of sections, each with its own page (`#/settings/<section>`; the browser's
  "Back" and "‹ Settings" return to the list), the version under the list:
  - **Player** — "Preferred language" (audio, subtitles and the trailer language; 13 languages),
    skip mode, autoplay of the next episode and a 5/10/15 s countdown, seek steps,
    "Always through the server" (forced transcoding);
  - **Home and Explore** — Home shelves: a switch and ↑/↓ on each, "Restore the default
    order" (stored as the set of hidden ones `hiddenShelves` and the order `shelfOrder`: future shelves
    are on by themselves); the "Explore" collections the same way: a switch and ↑/↓ on each,
    "Restore the default collection order" (`hiddenHubs`, `hubOrder`). In an empty search the
    watchlist is always shown in full. Settings stay in this browser (`localStorage`): unlike the
    Apple apps' iCloud, nothing syncs them;
  - **Loge Server** — the address (with a check and a reset);
  - **Server and account** — server and connection address, reconnecting, switching servers, sign out.
- Loge Server is optional: when it can't be asked (down, refuses the token, no CORS), segments come from the
  file's own chapters ("Intro", "Credits", "Титры"…) and, for what they lack, from [TheIntroDB](https://theintrodb.org)
  (a request of its own, without the Plex token); the tracks panel says where they came from. Nothing there — no skipping.

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
an ffmpeg HLS transcoder), the Plex catalog (search, the watchlist page by page, watch history
`/userState`, title details, `PUT /actions/*`, the `/photo` resizer; a refused list, a refused
search and a reset — `state.watchlistFail`, `state.searchFail`, `state.resetWatchlist()`) and
Loge Server (segments, preferences, CORS) with a fake TheIntroDB that knows nothing. The `--mode fake` build points the catalog and the resizer there too and pins "today"
(`VITE_TODAY=2026-11-22`), so release dates in the fake don't go stale. The video is generated by
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
the timing adjustment goes to Loge Server → closing the panel starts the bar's 3 s over (it
stays, then hides; a pointer move restarts them) → timeline → the next episode card before the
credits (a pause freezes it, scrobble only at the credits) → autoplay as the credits start of the next episode (MKV → HLS, resuming from 0:40) → seeking back before
the offset restarts the transcoder → switching the dub (PUT streams, restart, the dub stored in
Loge Server) → Esc (stopped, transcode stopped) → choosing the started episode → movie: ▶ plays
from where it was left without asking, marking as watched, filters → settings (a list of four
pages, "Back" to the list, Loge Server, skip mode) → countdown mode ("Don't
skip", the button inside the intro) → "Credits" on the next episode card (the credits play with
the "Next episode" button, no autoplay) → Loge Server off (the fake TheIntroDB asked by the
show's TVDB id, without the Plex token) → keys → leaving the player while
it is still loading (nothing starts, no transcode is left behind) → the watchlist on
Home ("Want to watch" / "Not out yet": order, dates; a watched movie, a started
show (by `/userState`) and server titles, old agents' too, are on neither shelf; the account
token in a header, none for the resizer) → empty search (shelves, the hint with an empty
list) → searching "тест" (one request after typing, "On the server" and "Not on the server" without repeats) → the bookmark in search adds → Plex
refuses: rollback and "Plex watchlist" → a title page (catalog details, add / remove) →
a title page from the server, an old agent's too ("Open in the library") → title pages: one wide
button, round icons filled while on, their tooltips, narrowed to a phone and back → the catalog
down (server titles with a note, "Nothing found") → deleting from a Home shelf and
rolling back a refusal → "Not out yet" off in settings: not on Home, still in an empty
search → "Explore" collections moved in settings (the page follows, the shelves keep their order,
narrowed to a phone and back) and reset → a show opened on E3 while the catalog's E1 and E2 come
late (E3 still in view at 375 px and wide) → "⋯" low on a phone turned sideways opens upwards → a phone turned
sideways keeps its content out of the side safe areas (emulated in Chrome) → the phone layout without horizontal
scrolling (search, the title page, the skip countdown and the settings pages included) → the browser talked only to the fakes.

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
- `VITE_PLEX_TV_URL`, `VITE_PLEX_AUTH_URL`, `VITE_PLEX_DISCOVER_URL`, `VITE_PLEX_IMAGES_URL`,
  `VITE_YOUTUBE_URL`, `VITE_THEINTRODB_URL`, `VITE_TODAY` — for the fakes only.
- The app name is a single constant, `APP_NAME` in `src/config.ts` (and `<title>` in
  `index.html`).

## What Loge Server needs to provide

Every request to Loge Server carries the `X-Plex-Token` header, so the browser first sends a
preflight `OPTIONS`. Loge Server sends CORS headers since version 0.1.9 (in `main`); checked on
`https://loge-server.example.com`: the preflight gets 204 with the headers below. Without CORS
(an old or a custom Loge Server) segments come only from the file's chapters and TheIntroDB, and a show's
timing and dub live only in `localStorage`.

- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, PUT, OPTIONS`,
  `Access-Control-Allow-Headers: X-Plex-Token, Content-Type, Accept`, an answer to the preflight
  `OPTIONS` without a token check. Requests: `GET /v1/segments/{ratingKey}`,
  `GET/PUT /v1/preferences/{key}`, `GET /healthz`; the `X-Plex-Token` header is the access token
  for the Plex server (as on Apple TV).
- For recommendations and trailers — `GET /v1/recommendations?seeds=…&language=ru-RU` and
  `GET /v1/videos?item=…&language=…` (Loge Server with a TMDB key, branch `recommendations`;
  without the key they answer 404, and those shelves and the button are missing). The browser never talks to TMDB.

## Layout

```
src/core/      pure logic without the DOM: Plex models, plex.tv/PMS/Loge Server and Plex
               catalog (plexDiscover) clients, matching the catalog with the library and the
               watchlist shelves (catalogMatch), SkipPolicy/SkipController, adjustment, show
               preferences and their sync, track selection, playback plan, BIF, subtitles,
               segments without Loge Server (chapters, TheIntroDB). Tests are in src/core/__tests__
src/app/       session state (sign-in, server, connection), the watchlist and the library index
               (watchlist.ts), recommendations (recommendations.ts), "Explore" (explore.ts),
               catalog seasons (catalogShow.ts); tests in src/app/__tests__; loading hooks
src/player/    PlayerSession (engine: <video>/hls.js, file time, skipping, progress,
               next episode), PlayerPage, ScrubBar, TracksPanel
src/pages/     home, libraries, movie, show, search, catalog title, settings, sign-in screens
src/ui/        cards, shelves, icons, shared layout, dialogs, the "More" menu, deletion,
               trailers, catalog seasons and episodes
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
- **The Plex catalog — auth in headers** (the account's `X-Plex-Token`,
  `X-Plex-Client-Identifier`, `X-Plex-Product`, `X-Plex-Language`), as in the Apple app, and
  not in the query as for PMS and plex.tv: this path is tested on the real Discover, and the account
  token stays out of URLs. The cost is a preflight for every new URL (cached by the browser).
- **The library index** for matching — all movies and shows of the sections
  (`/library/sections/{id}/all`), refreshed at most every 10 minutes; the watchlist — up to 500
  titles, 100 per request.
- **Old Plex agents** (no `plex://` in `guid`) are matched with the catalog by type, title
  and year (the Apple app matches only by the catalog key, and such a title stays both in "Not on the
  server" and in "Want to watch"). Only for such titles: a title with a key and the same
  name and year is a different title (a remake).
- **Pressing the bookmark again before Plex answered the last press is ignored** (the
  Apple app sends a second request): that way requests don't overtake each other.
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
- The Plex catalog (Discover): CORS checked with curl (2026-11-22) — the preflight of GET and PUT
  answers `Access-Control-Allow-Origin: *`, methods with PUT, allows the headers
  `X-Plex-Token`, `X-Plex-Client-Identifier`, `X-Plex-Product`, `X-Plex-Language`, `Accept`
  (`/library/metadata/a,b/userState` included); a GET with a token was checked separately only
  with `X-Plex-Token`, `X-Plex-Client-Identifier`, `Accept`. Search, the list, `/userState`
  and `PUT /actions/*` were not called from the web with a token — only against the fake; the response
  formats come from the Apple app (the list and `/userState` checked there against a real account).
- New on the night of 2026-11-23 — only against the fakes: Loge Server's recommendations (the home
  Loge Server has `/v1/recommendations`; `/v1/videos` is on a Loge Server branch, not deployed yet, until
  then there is no "Trailer" button), `DELETE` on a real PMS (the CORS preflight for DELETE and
  the answer with "Allow media deletion" off are not tested; the refusal texts fit any
  status), the catalog's `children` and `/actions/scrobble` on `metadata.provider.plex.tv` from
  the browser (CORS not tested; Plex Web does the same from its own domain), the embedded YouTube
  player (in the smoke test a fake page stands in for it; some videos forbid embedding —
  for that there is "Open in YouTube"), the `/hubs/sections/home/*` collections.
- A title of an old Plex agent whose year on the server differs from the catalog's (or whose
  title is translated differently) is not "recognised": it stays in "Not on the server" and in "Want
  to watch".
- On a phone (up to 560 px) the sections — Home, libraries, Explore — are at the bottom of the screen, like
  the tabs of the iPhone app; the header keeps the logo, the magnifier and the gear. With many libraries
  the bottom bar scrolls sideways. On a computer the sections are in the header; their links scroll
  with a fade at the edge if they don't fit.
- Missing: Plex managed users (Plex Home), playlists, a PiP button, quality selection
  (always the maximum, `videoQuality=100`).
- Autoplay: if the browser doesn't allow starting the video without a gesture, a large
  ▶ button is shown.

## License

MIT, see [LICENSE](LICENSE).
