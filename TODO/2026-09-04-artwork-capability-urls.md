# Artwork capability URLs (server-side ask)

Date: 2026-09-04

Status: sent 2026-09-04, landed server-side (v0.23.4) same day. Client cutover
implemented; see COMPLETED.md "Artwork capability URLs: client cutover, and a
real bug caught in UAT" for what landed and a real absolutization bug UAT
caught and the fix required.

## Context

Artwork requests (`GET /api/v1/catalogue/artwork/{id}`) require an
`Authorization: Bearer` header when `catalogue.api.token_file` is configured. A
plain `<img src>` can't attach a header, so the client is forced to `fetch()`
every poster/thumbnail as a Blob, convert it to an object URL, and hand-roll
its own caching, in-flight request dedup, and (until 2026-09-04) viewport-based
lazy-loading — reimplementing, in JS, things the browser already does natively
for an ordinary `<img>` tag. This was a live source of client bugs: a
hand-rolled concurrency scheduler with a slow silent leak was found and removed
from `MachaMediaApi` this session.

Playback stream and subtitle URLs already solve this correctly: they're
documented as "capability URLs... loaded without the permanent Bearer token" —
i.e. short-lived, scoped, URL-embeddable tokens handed out as part of an
authenticated session response (the standard signed/pre-signed URL pattern —
same idea as S3, GCS, Cloudinary signed delivery). Artwork never got the same
treatment.

## The ask

Extend that same mechanism to artwork, so catalogue responses
(`GET /api/v1/catalogue/items`, `/items/{id}`, `/search`, etc.) can embed a
ready-to-use artwork URL directly on each artwork reference — already
signed/tokenized, no separate exchange call needed — instead of (or alongside)
the current bare `id` that the client has to turn into an authenticated
request itself.

Requirements, from the client's side of the contract:

- **No extra round trip.** The signed URL needs to arrive embedded in the
  catalogue response the client already fetches, not from a separate "give me
  a token for this artwork ID" call — otherwise the client still needs JS
  orchestration and nothing has actually simplified.
- **Short-lived and scoped** to exactly that one artwork object, not a general
  Bearer-equivalent — same spirit as the existing stream/subtitle capability
  URLs, so reuse however those are already signed/generated rather than
  inventing a second mechanism.
- **Cacheable.** A normal `Cache-Control` header on the artwork response so
  browsers can cache it across reloads the way they already do for any other
  image — the client's current hand-rolled in-memory cache can't do this (it
  doesn't survive a page reload).
- **Backward compatible.** The existing header-authenticated
  `/api/v1/catalogue/artwork/{id}` endpoint should stay as-is for any other
  consumer; this is additive.
- Worth deciding: session length vs. token TTL. If a browsing session outlives
  the token TTL, is the intended recovery just "re-fetch the catalogue item"
  (which the client already does on navigation), or does artwork want a longer
  TTL than playback since it's lower-stakes?

## Payoff if this lands

`LazyArtwork` collapses to rendering a plain `<img src={artwork.poster.url}
loading="lazy">`. The client can delete `useViewportArtworkUrl`,
`artworkViewport.ts`, and most of `MachaMediaApi`'s artwork handling (cache
map, in-flight dedup map, retry wrapper) — the browser handles lazy-loading,
caching, dedup and concurrency for free, and there's no client-side state
machine left to have a bug in.
