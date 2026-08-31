# Behaviour-preserving refactor and artwork reliability

Date: 2026-08-31

## Scope

Refactor the existing client without changing its intended behaviour, fix the
pre-existing API URL expectation failure, strengthen coverage around high-risk
mechanics, and improve intermittent poster loading. Keep all application modules
eagerly bundled; ordinary catalogue artwork may remain viewport-lazy.

## Completed work

### Tests and API infrastructure

- Corrected the management API test to match standards-compliant
  `encodeURIComponent` handling of parentheses.
- Consolidated base-URL normalization, authenticated request headers and response
  body parsing in the shared HTTP compatibility layer.
- Preserved the public API-specific errors, messages and playback diagnostics.
- Added characterization coverage for playback route decoding, resume precedence,
  return routes and queue/media selection.

### Application structure

- Split service construction, route-back behaviour, music control, playback
  runtime ownership and playback orchestration out of `App.tsx` into focused
  hooks.
- Kept `PlaybackRuntime` application-scoped and stable while allowing resolver
  configuration to change without replacing the runtime.
- Extracted player option presentation from `PlayerScreen`.
- Preserved route, queue, resume, teardown and presentation behaviour.

### State, polling and diagnostics

- Added shared validated JSON persistence helpers for playback queue, music
  playlist and volume state.
- Added a reusable polling task with explicit overlapping/non-overlapping policy
  and tests for stop semantics.
- Retained non-overlapping ingest polling and the existing overlapping status
  polling behaviour.
- Centralized unknown-error message conversion.
- Disabled diagnostic console noise in tests without disabling the diagnostic
  ring buffer.

### Web playback internals

- Extracted media diagnostics and HLS error/recovery policy from the Web player.
- Extracted and tested segmented subtitle manifest validation, legacy VTT
  detection, segment selection and neighbouring-segment windows.
- Preserved stale-generation guards, timeline publication and bounded HLS media
  recovery.

### Styles

- Split the monolithic stylesheet into ordered base, settings, metadata, manage,
  ingest and status stylesheets.
- Preserved stylesheet order and both modern and legacy Samsung rendering rules.

### Eager modules and core assets

- Confirmed there are no `React.lazy` calls or dynamic module imports in the
  application source.
- Retained one eager application bundle rather than introducing route or feature
  splitting in response to bundle-size warnings.
- Consolidated the logo to one canonical public asset and explicitly preloaded it
  for the boot splash and core application chrome.
- Kept ordinary catalogue artwork viewport-lazy.

### Poster reliability

- Extended bounded retry coverage for transient artwork failures so brief cluster
  or backing-store recovery does not leave a mounted card permanently empty.
- Reject empty and explicitly non-image artwork responses before they enter the
  shared Blob cache.
- Evict and refetch cached artwork when the browser rejects image decoding, with
  bounded retries and a clean placeholder fallback.
- Preserved monotonic viewport demand: once nearby artwork is requested, scrolling
  away does not cancel the useful shared request.
- Added regression coverage for response validation and cache eviction/refetch.

## Verification

- Full test suite: 38 files, 189 tests passed.
- TypeScript typecheck passed.
- Modern Vite production build passed.
- Samsung/Tizen legacy production build passed.
- Both builds emit one eager application entry bundle; Samsung additionally emits
  its required eager legacy polyfill bundle.
- Logo preload resolves correctly for both root-relative Web and relative Samsung
  package paths.
- `git diff --check` passed.

The configured development Macha endpoint was offline during final verification,
so live server poster testing was not available in that pass.
