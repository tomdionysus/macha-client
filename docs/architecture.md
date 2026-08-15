# Architecture

```text
                          Macha node
                 distributed media + catalogue
                             |
       /api/v1/catalogue       /api/v1/playback
          JSON + artwork       sessions + streams
                |                    |
       MachaCatalogueApi     MachaPlaybackResolver
                |                    |
          MachaMediaApi       PlaybackResolver
                |                    |
                +---------+----------+
                          |
                  React application
              + browser-history router
                          |
           +--------------+--------------+
           |              |              |
          Web          Android          Tizen
    video + hls.js     Media3 stub     AVPlay stub
```

The server owns playback negotiation and media transformation. The client owns controls and reports platform capabilities. Demo mode still uses a local sample file through the same resolver/player seam.

## Catalogue loading

A series page loads its series record and direct season children only. A season page loads its direct episode children. This maps directly to Macha's `parent_id` hierarchy and avoids eagerly loading every episode when opening a series.

Season pages prefer season artwork and fall back to series artwork. Episode cards prefer `still`/thumbnail artwork.

## Routing

The shared React application owns URL routes. Browser Back/Forward therefore works on Web without special state handling, and the same navigation model can be driven by Android/Tizen host keys later.

Production web hosting must fall back to `index.html` for unknown application paths.

## Rules

- The client does not know about DHT extents, replicas, peers or routing.
- The catalogue wire model mirrors Macha rather than inventing a client-specific server API.
- The client never transcodes.
- The server chooses Direct Play first, Remux second and Transcode only when required.
- Platform-specific code is restricted to capabilities, playback, application lifecycle and remote-key integration.
- React owns catalogue browsing, routes, search, hierarchy, focus navigation and playback chrome.
- Continue Watching is installation-local state, bounded to three unfinished items and never uploaded.
- There is no cloud service, account system, advertising, recommendations, social activity or global watchlist.
