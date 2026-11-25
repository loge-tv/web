# Sepia TV web: notes for Claude

The app, its commands and its layout are in README.md. This file covers what README doesn't: the
screens of this app that the site shows.

## Screens on the site

The site (sepiatv.com, repo sepiatv/landing) shows seven screens of this app in
`assets/shots/web/<screen>.jpg`. When a change alters one of them (layout, text, an icon, a colour,
spacing; shared styles and icons count too), the site goes on showing the old interface until the
screen is reshot. So a change to these screens isn't done until the snapshot tests are updated and
the site has the new shots.

| Screen | What it is | Mostly in | Shot for the site by (rig step → file in `web-v2/`) |
|---|---|---|---|
| `home` | Home: «Продолжить просмотр», «Хочу посмотреть», «Недавно добавлено» | `src/pages/Home.tsx`, `src/ui/cards.tsx`, `src/ui/Layout.tsx` | `shots.mjs` home → `home.png` |
| `recs` | Home with «Потому что вы смотрели» and «Похожее на сервере» at the top | `src/pages/Home.tsx`, `src/app/recommendations.ts`, `src/ui/cards.tsx` | `shots.mjs` recs → `recs.png` |
| `show` | A show's page: Sprite Fright as a show of three episodes | `src/pages/Show.tsx`, `src/ui/catalogEpisodes.tsx` | `shots.mjs` show → `show.png` |
| `trailer` | Sintel's page with the «Трейлер» dialog | `src/ui/trailers.tsx`, `src/core/youtubeEmbed.ts`, `src/pages/Movie.tsx` | `trailer.mjs … 6.6` (real YouTube, the approved moment 6.6 s: Sintel in the snow) → `trailer-6.6.png` |
| `playback` | The player with subtitles and the bar | `src/player/PlayerPage.tsx`, `ScrubBar.tsx`, `TracksPanel.tsx` | `shots.mjs` player → `player-bar.png` |
| `intro` | The countdown before the intro is skipped | `src/player/PlayerPage.tsx`, `src/core/skipPolicy.ts` | `shots.mjs` intro → `intro.png` |
| `skip` | The end credits with the «Следующая серия» card | `src/player/PlayerPage.tsx`, `src/player/playerSession.ts` | `shots.mjs` skip → `skip.png` |

`src/styles.css` and `src/ui/icons.tsx` reach all of them.

TMDB (trailers, recommendations, titles) comes from the TMDB proxy. The rig's `fake.mjs` has TMDB
only on its Sepia Server, so the snapshot tests and the rig's `shots.mjs` and `trailer.mjs` start this
checkout's fake proxy (`dev/fake-tmdb.mjs`) with the rig's data. It gives no Russian names, so the
Blender films keep their English ones.

### Snapshot tests

`dev/screens/` holds Playwright snapshot tests of these seven screens with baselines in
`dev/screens/baseline/<screen>.png` (1600×1000). They build this checkout in fake mode and run it
against the landing rig's `fake.mjs`, the test library of Blender films the site's shots use. To
keep them exact, they pause the player at fixed positions, hide its picture, and replace the YouTube
embed with the fake's stand-in, so the tests never load youtube.com.

```sh
npm run screens          # builds, then compares; diffs in dev/.out/screens-results
SKIP_BUILD=1 npm run screens         # reuse the last build (dev/.out/screens-dist): only while src is unchanged
npm run screens -- -g "intro|skip"   # some of them
npm run screens:update   # write new baselines after an intended change
```

They need the landing checkout next to this one, with its rig at
`../landing/shots-raw/harness` (`shots-raw` is not in git; `LOGE_SHOTS_RIG=<dir>` points elsewhere),
and Google Chrome (`CHROME_PATH` for another path). Without the rig they are skipped. They run
locally only and are not part of `npm test` or CI.

### When a change touches one of these screens

1. Run `npm run screens`. A red test names a changed screen; check its diff. The comparison is exact
   and tied to this Mac's Chrome: if all seven go red without a UI change, it is a Chrome update, so
   rewrite the baselines (`npm run screens:update`) and don't reshoot for the site.
2. If the change is intended, run `npm run screens:update`. Look at the new baselines and commit them
   with the change.
3. Reshoot the changed screens for the site on the rig. Run this from `../landing/shots-raw/harness`,
   after `npx vite build --mode fake --outDir <rig>/tools/.web-cache/dist --emptyOutDir` here:
   `ONLY=home,show node tools/web/shots.mjs <this checkout> tools/.web-cache/dist <out>`.
   The steps are listed in the table above; sign-in always runs. The trailer comes from
   `tools/web/trailer.mjs <this checkout> <build> <out> 6.6`, which needs a build with the real YouTube.
   Its header explains how to run it. YouTube walls off an address that plays the trailer too often, so ask the other Loge sessions
   before playing it.
4. Put the PNGs into `../landing/shots-raw/<date>/web-v2/<file>.png` and send their paths to the
   site's session (Landing loge), saying what changed. The site's `.jpg` files are made by it.

Use only the approved state of the rig: the frames and titles the user picked. Leave the rig's
`fake.mjs` and `media/art` as they are, because the Apple and Android apps' rigs copy them; ask
Landing loge first.
