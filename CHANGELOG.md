# Changelog

## 0.3.12

- make the series title the primary heading on season pages and demote the season title to the smaller eyebrow treatment;
- reduce the initial boot splash duration from two seconds to one second.

## 0.3.11

- show movie poster artwork prominently beside the title and synopsis on movie detail pages;
- replace movie detail text actions with the same circular Play / Play from start controls used by the player;
- add Play from start to the in-player transport controls and only resume playback when the seek-to-zero operation succeeds.

## 0.3.10

- Add explicit Play from start alongside resume playback for movies and episodes with stored progress.
- Encode start-from-zero in the player route so playback history/back-forward remains deterministic.
- Show resume/start-over controls on episode stills while preserving the whole still as the normal play target.
- Suppress the boot splash on browser back/forward document restoration; normal SPA navigation continues without replaying it.

## 0.3.9 - 2026-08-15

- add structured client-side playback diagnostics covering session control, browser media state, buffering, HLS fragment activity and failures;
- retain an in-memory diagnostic ring buffer and expose `machaDiagnostics.dump()`, `copy()` and `clear()` in the browser console;
- redact playback capability tokens and authentication-like fields from exported diagnostics;
- log Macha playback request latency, status and error bodies, including `503 playback_unavailable` responses;
- log startup/resume position, autoplay outcome, direct/transformed seek latency and stream reconfiguration timing;
- log HTML media `waiting`, `stalled`, `seeking`, `seeked` and error state with buffered/seekable ranges;
- log hls.js manifest, fragment, level-switch, recovery and fatal/non-fatal error events;
- remove the React StrictMode wrapper because development effect replay duplicated side-effectful playback-session creation/cleanup.

## 0.3.8 - 2026-08-15

- integrated the player with Macha 0.7 playback sessions instead of the preview-only production resolver;
- send browser codec/container/display capabilities and let Macha negotiate Direct Play, remux or transcode;
- added Web fragmented-MP4 HLS playback through native HLS or hls.js;
- added in-session playback mode, quality, audio, subtitle and media-representation controls;
- use Macha session PATCH for transformed seeks and stream changes, preserving absolute playback position across HLS generations;
- explicitly delete server playback sessions when leaving the player;
- report direct-play support for browser MP4/WebM and supported MP3/FLAC/Ogg containers;
- keep permanent Bearer authentication on session control requests while loading returned stream capability URLs directly.

## 0.3.7 - 2026-08-15

- reduce the application-wide type scale while retaining the existing Roboto hierarchy;
- make player chrome flush to the left, right and bottom edges with no border or radius and a more transparent black surface;
- change the masked splash highlight to linear motion;
- move the splash highlight start further into the right side of the mask and its end farther beyond the left edge so the band fully clears the logo.

## 0.3.6 - 2026-08-15

- rebase the client changes directly onto the supplied 0.3.5 source archive;
- reduce the configurable splash to two seconds, shorten the masked flash travel and keep only a small lead-in/out around the sweep;
- switch the self-hosted UI font to Roboto Variable;
- show `Macha` beside the toolbar logo and centre the platform label within the right-hand toolbar column;
- make headings and main text neutral grey, keeping crimson exclusively as an interaction/accent colour;
- replace the player's red gradient/fuzz with crisp, bordered, semi-transparent black control chrome;
- make every player transport button the same circular size and replace ten-second arrow labels with standard SVG back/rewind/play-pause/fast-forward/options icons;
- fix episode playback navigation by making the complete episode still a real `/play/:id` link and delaying rail pointer capture until an actual drag begins;
- show the episode play overlay only on hover or keyboard/TV focus.

## 0.3.5 - 2026-08-15

- moved the initial splash completely outside React; the application is not mounted until the configured minimum splash lifetime has elapsed;
- measure splash lifetime with `performance.now()` and re-check after timer wake-ups so browser timer behaviour can make the splash later, never earlier;
- make the visible masked logo sweep occupy most of `splashDurationMs` instead of capping it at 650 ms;
- replace IBM Plex Sans with self-hosted Source Sans 3 Variable;
- darken and saturate the Macha crimson palette further, with translucent blurred highlight surfaces and title glow;
- reduce television/control focus outlines to one pixel.

## 0.3.4 - 2026-08-15

- fixed the splash lifetime so `splashDurationMs` is the sole dismissal authority; CSS animation events can no longer terminate it early;
- retain the three-second splash default and keep the moving logo flash as presentation within that guaranteed lifetime;
- replaced the muted red accent range with a substantially darker, more saturated crimson palette;
- applied the darker palette to focus chrome, active surfaces, playback progress, loading indication and toast surfaces.

## 0.3.3 - 2026-08-15

- increased the configurable initial splash default to three seconds;
- made episode cards themselves explicit play controls, including a centred play affordance over the episode still;
- introduced a named Macha dark-red accent palette in the shared stylesheet;
- reduced TV/control focus outlines from three pixels to two and changed them from stark white to a muted red;
- applied the same restrained red accents to active navigation, playback progress and primary player controls.

## 0.3.2 - 2026-08-15

- fixed the splash so its actual rendered lifetime is driven by `splashDurationMs`, and increased the default to two seconds;
- derive the masked logo-flash delay/duration from the configured splash lifetime;
- centred full-screen error presentation and added a bundled SVG error icon;
- added a routable `/play/:id` player page with auto-hiding lower title/control chrome, play/pause, ten-second seek controls and an interactive progress slider;
- keep the player page usable as an interactive preview while the Macha streaming API is still unavailable, while retaining the platform player/resolver seam for real playback;
- route Continue Watching, episode selection and music tracks into the player page;
- added Music as a first-class client section using Macha's existing artist → album → track catalogue hierarchy;
- added first-class music routes, artist/album pages, track lists and square artwork treatment;
- keep music playback out of the three-item Continue Watching state;
- allow horizontal arrow keys to operate a focused playback range control rather than being consumed by spatial TV navigation.

## 0.3.1 - 2026-08-15

- increased the initial splash duration to one second and moved the timing to `src/settings.ts`;
- changed the splash so the Macha SVG is used only as an alpha mask: the logo is otherwise transparent and only the right-to-left highlight is visible through it;
- removed the rounded focus/selection chrome from the titlebar logo;
- replaced inline Loading text with a transparent full-page spinner overlay;
- delay the loading spinner until a request has remained pending for the configurable loading indicator delay.

## 0.3.0 - 2026-08-15

- integrated the Macha logo into the application shell and initial splash;
- added a 500 ms logo-only splash with a right-to-left masked highlight animation and reduced-motion fallback;
- switched typography to self-hosted IBM Plex Sans Variable through Fontsource;
- replaced in-memory page selection with browser-history routes for Home, Movies, TV Shows, series, seasons, episodes, Search and Settings;
- added separate series and season pages;
- changed series loading to fetch season summaries only, with episodes fetched when a season page is opened;
- use season artwork before series artwork on season pages;
- added an interactive horizontal episode rail with still artwork, title, date placeholder and synopsis;
- reserved `releaseDate` in the UI model and documented the Macha/TMDB provider work required to populate it later.

## 0.2.0 - 2026-08-14

- renamed the client to Macha Client;
- replaced the provisional HTTP contract with Macha's `/api/v1/catalogue` API and exact catalogue item model;
- derive Home and show/season/episode hierarchy from existing catalogue list queries;
- added optional Bearer authentication, including authenticated artwork loading;
- removed invented playback and server-side progress endpoints;
- made Continue Watching strictly local and limited to three unfinished items;
- retained Web playback and Android/Tizen platform boundaries behind a separate playback resolver interface.

## 0.1.0 - 2026-08-14

- initial React/TypeScript web client prototype with Web, Android and Tizen platform abstractions.
