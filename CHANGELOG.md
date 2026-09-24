# Changelog

## Unreleased

**Needs `@machafoundation/core` published first.** Everything below is built and tested against core's linked tree, last at `e840d72`, which is well past the published 0.18.0: the viewer-text cut, search sorts and categories, the Import and Unmatched routes, server 0.56.0's codes, `seedEndpoints`, hedged session validation and the probe-first mint, and the decode fallback. `main` must resolve a published core carrying all of it, and the suite, typecheck and build must be run against that copy before the merge, as they were for 0.18.0.

- **Log out ends the session on the server, and the revoked token is never used again.** Tom's ruling. Log out used to call `api.logout()` and carry on with the revoked token in memory until a request came back 401. It now stops playback and waits for the node's session to close, because a playback session opened under a token cannot be closed once that token is gone and a one-slot node would hold its transcode for thirty minutes. Then it calls core's `signOut()`, which clears local state first and then revokes, and starts the session again so the app learns whether an anonymous viewer may browse here or must sign in. If the cluster cannot be told, this device is still signed out, and a notice says the session stays valid at the server until it expires. Unit-tested against the network (the revoke carries the old token and nothing after it does; a failed revoke still restarts); not yet run live.
- **Remembered nodes survive a reload.** Nodes confirmed in an earlier run were seeded as `'environment'`, and core's health cycle rewrites the remembered list from `'discovered'` entries only, so the list was wiped on the first cycle after every load and the fallback worked on alternate loads. Found by the Android TV client and seen live here: two URLs 20 s into a load, none at 114 s. Seeded now through core's `seedEndpoints` (core `b47773d`), which also keeps a remembered node that has not answered yet.
- **Status offers Reset association only to an account that may do it.** It was shown to any account that could view status, gated on a configuration flag rather than a role; seen as a view-only test account. The server asks `manager` of every change under `/api/v1/manage`, so Status now gets the manage API only with that role.
- **Server 0.56.0's codes are worded here.** Job errors on the torrent list, a torrent's page and the file-import rows, catalogue results on Unmatched, Status diagnostics (UPnP, external address, startup, node connectivity), a torrent another node would not take (by `placement_failed`'s reason) and the Settings server card. A known code gets this client's sentence; a code that only says something failed underneath (`torrent_error`, `filesystem_error`, `import_failed`, `torrent_failed`, `ingest_failed`) also gets the server's sentence after it; an unknown code, or none from a node older than 0.56.0, shows the server's sentence. Needs core `a5b08f0`. Not yet seen against a 0.56.0 node.
- **A copied stream this device cannot decode is converted instead of failing.** Core's decode fallback (`e840d72`, Tom's ruling): once per playback, and never against a mode the viewer chose. Worded here as a notice and as a reason in the player options. Not yet seen live.
- **Bulk actions on torrents.** Tick rows (or the page) for a bar with Pause, Resume and Remove. Pause and Resume are enabled only when a ticked torrent can take them and apply only to those; Remove always asks and cancels any still running first; a partial failure says how many the server refused. Selection and the bar are shared list parts, which Unmatched now uses too. Not yet seen live.
- **Manage Unmatched is laid out like the torrent list, with each file on its own page.** A slim sortable table, the order and page in the address, bulk retry and delete kept; a file's page carries the result, its facts, the candidates beside the match search, and the manual form. Import's list, table, heading, sort, pager and item-page parts are shared by both. Both lists page at fifty rows; seen live at 614 unmatched files in 13 pages. The Manage nav drops its unmatched count.
- **Import is two pages, Torrents and Files, under the standard submenu**, and a torrent's page is laid out around the stage under way: a headline for it, tiles for download, upload, ratio and added, a card per stage and an identity card. The torrent columns hold still as their values change, and the text is slightly larger.
- **Every word a viewer sees is this client's.** Tom's ruling: core composes no viewer text. Episode, season, track, disc and album labels, card subtitles, sort and category names, playback notices and failure sentences, the stream-status lines, the scrubber clock, startup names and every error, all in `src/text/viewerText.ts` from core's fields and codes. An error's `message` is core's log text and is never shown.
- **Search is full width, sorted, filtered and article-blind.** "Sort By" options from core (Relevance, Title, Year, Recently added); type pills for Movies, TV Shows and Music; "the", "a" and "an" never trigger or reach a search; episodes read the series then "Season x Episode y", each linking; tracks read "Artist - Album (year)"; the A-Z bar only in title order; a notice when nothing matched. Continue Watching uses the same episode line.
- **Television focus follows the Android TV client's scorer.** Direction is judged from edges, not centres; left and right stay in the current row and stop at its end; up and down take the nearest row. The web keeps no move-undo, by Tom's decision.
- **The player's cursor shows whenever the mouse moves**, and hides after three seconds of rest, instead of staying hidden in fullscreen unless the pointer crossed the control bar.
- **A reclaimed Direct Play source is no longer read as unsupported.** The read-ahead worker's source-gone report could arrive after the element's error, which was then judged a terminal failure; the element now asks the worker what the node said first. Run live: source gone, re-created, playing on.
- **Smaller touches.** Uptime on the Status node cards; a header never runs past a table's edge; a music track card names its album with the artist below; the login screen has a larger logo beside its title and no "no permissions" notice.

- **The native-HLS path no longer probes a fragment before attaching.** The Samsung build's player cannot ride a node's `500 segment_not_ready` hold, so this client used to request one byte of the first fragment until the node served it. That zero-byte check is gone. The player now declares `needsProducedSource`, and core holds the source back until the session itself reports media produced, reading JSON rather than poking the media. Needs core `3e611b8` or later, unreleased. Not yet seen on the set.
- **The Import page is a compact job list, in the shape of a torrent client.** One slim line per torrent with name, size, progress, status, down, up, ETA, seeds, peers, ratio and added, and pause, resume and remove on the line. Sorted by a Sort by control or by pressing a column header, newest added first by default, and deterministically: ties fall to the name and then the job id, so a poll never swaps two rows, and what the server cannot say yet sorts last either way. The sort travels in the address, so it survives a visit to a torrent and back. Each torrent has its own page for the transfer, torrent, import and catalogue detail that used to expand inside its card. The two add forms are one slim bar, filesystem imports use the same rows, and less important columns drop out at narrow widths.
- **`useNodeIdentity` is gone.** It taught the registry which endpoints were one node by calling core's `applyAdvertisement` with the URLs matching each node in `/api/v1/status`. That is a membership call: it rebuilds the discovered list from what it is told, so any cycle whose snapshot lacked a node, or whose discovered endpoint matched neither a node's `api_endpoint` origin nor its `host:port`, would have deleted that endpoint. Core hit exactly that in its own monitor (`76d94ba`, "identity is not membership") and now claims identity with `claimNodeId`, asking every unclaimed endpoint for its `node_id` directly, so the hook had nothing left to do and one thing left to break. Checked against the deployed 0.18.0 bundle on 2026-09-23 in a foregrounded tab: three endpoints known and reachable across three identity cycles, none dropped, which is the configuration where the drop could not happen rather than proof that it never would. `nodeAdvertisements.ts` and both test files went with it; `preferredEndpointForNode` stays, because a viewer picks a node and `prefer()` names an endpoint.
- **The failure screen says what the node said, never core's log line.** It rendered `fatalError.message`, which by the time a failure has crossed `endpointFailure` is two of core's envelopes and a node address, and then walked the `cause` chain to say the rest of them beneath it. Both replaced by core's `playbackFailureDetail`, which carries the server's own sentence from whichever layer knew it; when no layer stated one the screen says its own, once, rather than falling back. The cap notice and the opt-in failure trail are unchanged, and the trail is where the whole chain still lives.
- **Choosing a node moves the stream instead of restarting it.** `selectNode` calls core's `PlaybackRuntime.moveTo`, which builds on the chosen node, keeps the old one presenting, and releases it at the cut. A node that refuses leaves the viewer where they were, with a sentence, rather than restarting behind them; a failed generation is retried on the preferred node. Needs core `5de9250` or later, which is unreleased. The first live run found a core fault (the old session released before the cut, then regenerated, yanking the viewer back and leaking the new one); core fixed it and both re-runs showed no leak and no yank-back. **What the viewer sees is not yet good**: the web handover abandons when the new node is slow to its first fragment, the relocation hold freezes the picture for 16-19 s, and the fresh start that follows can be black for 15 s. Not releasable until the handover arrives.
- **Each node's cost of starting a stream is measured by this viewer.** From the moment core asks for a session to the first media fragment, per node, latest figure only and unknown after ten minutes. Measured live at 1.8 s on fi-1 and 20.3 s on gbni-1 for the same transcode. It now leads a node move: the picker asks core for a position that far ahead plus core's margin, the old picture keeps playing while the viewer travels to the new stream's start, and the cut happens there. Live, fi-1 to gbni-1 with a 24.6 s lead completed with no stall in 270 samples, where the same move without a lead froze 15 s. Needs core `d58375a` or later, unreleased.
- **Every slow or failed start now says what happened before its first frame.** One `source-start-record` per start, armed before the source is set, on the element on screen and on a handover's or relocation hold's standby: element events, per-second state, fragments asked and received, hls.js errors, and the requests that left the page, observed rather than read from the Resource Timing buffer, which is full within seconds of load and had reported "0 requests" for starts that were fetching. Quiet for a first frame under 3 s. For the `readyState` 0 P0.

## 0.18.0

Released against `@machafoundation/core` **0.18.0** from the registry, which is the first published core carrying `prefer()`, `moveTo()`, `claimNodeId()` and `SOURCE_SUPERSEDED_STATUS`. The client had been developed against a `file:` link to core's tree while those were being built; `main` resolves the published package and the suite, typecheck and build were run against that copy before the merge. Bundle `index-CKNh5Q9D.js`, 633,692 bytes.

- **A viewer can choose which node streams to them.** Pills in the player's options panel, right-hand area, one per node with the serving node highlighted, sorted by name rather than by the registry's live ranking — that ranking moves with latency and cooldowns, so a list in that order re-arranges itself under the pointer between aiming and clicking. Grouped by `nodeId`, because one node is commonly two entries: a LAN address and an advertised name, and core stamps identity from `api_endpoint` alone, so `useNodeIdentity` advertises each node's `host:port` alongside it — restricted to URLs the registry already holds, since `applyAdvertisement` turns an unmatched URL into a discovered endpoint nobody can reach. Pressing a pin states a preference through core's `prefer()` and starts a new generation on that node at the position the viewer is at. Measured live: 2:11.795 on `fi-1` to 2:12.197 on `gbni-1`, with **13.2 s of black** between them, which is the cost of closing before starting. Core landed `moveTo` the same evening — build on the new node, promote, then release, so the picture survives — and this client does not call it yet; `TODO/ACTIVE.md` says so rather than implying the gap is closed. The preference is ordering and nothing else: it writes no health record, which the only previously public route, `recordSuccess`, would have done by dating a successful round trip that never happened.

- **A mode press no longer asks a node to copy audio this device cannot decode.** The transform table said remux meant copy-both, unconditionally, so pressing Remux on an AC-3 title asked for a copy of audio Chrome has no decoder for. Two endings, both measured on 2026-09-21 against `fi-1`: the element never leaves `readyState` 0 — six non-fatal hls.js errors over about 35 s, two fatal at 59 s, and **not one request reaching the node**, because MSE rejects the codec at the manifest and hls.js never asks for media — or, had a node served it, a silent film. `MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')` answers `false` here, and `"ec-3"` likewise. The server's own trace settled the other half: it built that generation in **48 ms**. The fix is not "remux with the audio transcoded", which the server refuses outright — *"remux repackages and copies every stream: to re-encode one, ask for mode=transcode with video=copy"* — so a press that cannot copy the audio now asks for `mode=transcode, video=copy, audio=transcode`, which is the plan the chooser produces for these titles unprompted and precisely what the press had been throwing away. Decided from `hlsAudioCodecs ?? audioCodecs`, because remux is delivered as fragmented MP4 and the delivery decoder is not always the element's; an unknown codec or absent capabilities transcode rather than gamble. The mobile client had written the same table independently and hit the same fault the same afternoon; core holds the rule at `choosePlaybackInstruction.ts:399-401` for the automatic path only, and a viewer pressing a mode by name has no entry point into it, which is why two clients reinvented it.

- **Keyboard seeking on the scrubber commits.** A focused scrubber steps on every arrow and page key — the browser's own range behaviour, arriving as a new preview position — while the commit fired only for a television's seek keys or Home/End. So the thumb moved, the playhead drew in the new place, and playback carried on where it was until focus happened to leave and `onBlur` committed it. Measured before: five `PageUp` presses moved the scrubber to 50% of a two-hour film and left the position at 59 s. `committingScrubberKey` now names every key a range input moves itself on; watched failing against the old list first, and re-measured live afterwards — five presses from 22:07 landing at 1:39:27, playing.

- **A session that holds no roles says so, and says what to do about it.** Such a viewer got the sign-in wall and its standing invitation, which is the one screen that cannot help them: their credentials were accepted and bought them nothing. The sentence now leads with the remedy — log in again, and only then ask an administrator for `media_viewer` — because a session granted nothing means a cluster carrying no anonymous viewer, an account that genuinely holds nothing, or core's credential-less re-mint having replaced a working session after a `401`, and two of those three are answered by signing in. Accurate about the state and wrong about the remedy is still a viewer sent to the wrong person. Decided through core's `sessionLockedOut` rather than by testing the array, so `undefined` stays *unknown*: a node too old to state roles permits everything, and saying "you have no roles" there would lock a viewer out of a cluster that never answered the question. A refusal gets its own sentence and never mentions roles. The remedy ordering is the finding, so a test fails if *administrator* ever precedes *log in* in the string.

- **Times are presented in local and dealt in UTC everywhere else.** Tom, 2026-09-21: *"Macha absolutely needs to handle multiple timezones across sites. They WILL be in different timezones... timezones are a presentation problem."* The nodes ran EEST, CEST and BST that evening, and a session timeline handed to the server session was an hour out because this machine matched one node's zone and was read against another's — silent, plausible, and it survived both ends of the exchange. `presentedTime` renders the reader's own zone **with the zone named** (`21 Sep 2026, 18:51:52 GMT+3`), which is what stops a local hour being mistaken for the node's; `zuluTimestamp` is the interchange form for anything leaving this client for another machine or read beside a journal. Never-stated renders `—` rather than 1970. Content keeps the viewer's zone: an air date is about their evening, not about correlating two journals.

**Watched live: all five, against the cluster on 2026-09-21.** What was *not* established is recorded rather than implied: a player that sits at `readyState` 0 while the node's journal says it served in 208-247 ms is seen on both playback paths and has no mechanism — three client-side explanations for it were measured and all three were wrong, so `TODO/ACTIVE.md` carries the shape and no cause. The node control's own seamless half waits on core's `moveTo`, and the subtitle-segment naming this client invents on the server's behalf is parked on Tom's instruction.

## 0.17.3

- **The picture stays up through a mode switch, and through a failover.** Two blackouts, both measured live on 2026-09-21 against the cluster and both now zero. Selecting Transcode while Direct Play ran blanked the element for **16.5 s**: the hold built for seeks in 0.17.2 was never asked to run, because a representation change arrives as `transition: 'continue'`, `play()` offers it to `handOverToSource()` first, that declines silently — the outgoing source is Direct Play and a handover needs managed HLS on both sides — and the hold then sat behind `transition !== 'continue'`. Measured before: `source-load-begin`, `media-element-reused`, `readyState` 0, no `relocation-hold-begin` anywhere. The hold is now asked on both transitions and declines on its own terms, which `canHoldThroughRelocation()` owns: hls.js must drive the replacement and the outgoing element must have a frame up. It no longer asks the outgoing side to be a manifest, which is a fact about media the hold never touches, and the Direct Play case was watched failing against the old clause before it went. Measured after, twice: `relocation-hold-complete` at 2,726 ms and 4,977 ms, `readyState` never leaving 4. Separately, a failover threw the picture away **seven seconds before anything could replace it**: `failSourceGeneration` destroyed the hls.js instance the moment it diagnosed a terminal failure, and `destroy()` detaches the MediaSource — `media-abort` and `media-emptied` at `HAVE_NOTHING`, nine seconds of black, all of it after the failure was already known, with the hold then declining correctly because there was nothing left to hold. A failed generation is now stopped where it fails, so it fetches nothing more from a node that has gone, and destroyed where it is replaced, on the three paths that take the element — the rule `promoteHandover` already stated. Measured after: the hold engaged on the failover itself, `readyState` never dropped below 2, `videoWidth` never left 1920, and the viewer landed 330 ms into the new generation. Two corrections ride with them: the hold stands the stall budget down, which it had been getting for free from `holdPicture()` on the seek path and does not get on a relocation no control asked for; and a promotion releases the outgoing side's Direct Play read-ahead, which only the teardown path did.

- **The transcode handover gives up on a join it is losing, instead of waiting the budget out.** Measured live 2026-09-20: a transcode switch left two elements alive for 29.7 s, the replacement never buffering past ~2 s while the join sat at 33.9 s, and the fallback then put the viewer back 20 s. Direct and remux were correct on the same title, session and node. The join is not a fixed point — it recedes at the rate the viewer is watching while the replacement fills at the rate its node produces — so `handoverJoinLost()` reads both rates from the element and abandons once the distance is not closing fast enough to close in the remaining budget, and `handoverFallbackPositionMs()` attaches where the viewer actually got to rather than where core computed before the attempt began. Watched executing on 2026-09-21 — `handover-abandoned reason=join-receding-faster-than-it-fills` at about six seconds, twice, with the fallback landing correctly — but only under changes that were reverted the same evening, so no path this client takes on its own reaches them yet. `TODO/ACTIVE.md` says so rather than claiming the verification.

- **Every playback deadline comes from the node serving the source.** Core reads each node's `playback.startup_timeout_ms` and `segment_timeout_ms` from `GET /api/v1/status` and states them per endpoint as `budgets`. Three call sites still held constants derived from one node's configuration, and a partial adoption would have let the shortest surviving constant silently win, so `awaitNativeHlsFirstFragment`, `preflightWebHlsSource` and the stall watchdog moved together. Both nodes on this cluster state the figures the constants were derived from, so the adoption is currently indistinguishable from the old behaviour at runtime; a node configured differently is what would prove it.

- **Direct Play reports the cover the element's buffer cannot see.** The read-ahead worker holds bytes in front of the element that `video.buffered` never shows, so `forwardBufferMs` understated the real cover on precisely the path carrying the most of it, and core did its runway arithmetic from element buffer alone on 453 of 748 titles. Reported as `readAheadBytes`, and absent rather than zero where there is no cache, because a client that cannot measure a cache is not a client whose cache is empty.

- **The handover's runway gate asks the element, not the last event about it.** `publish()` reports while the element is playing, so the age of the last sample has no bound, and an element that has stopped emitting leaves a figure that can only overestimate the runway — which is exactly the element the gate must not be generous about. Raised by the Android TV client on 2026-09-19, which hits the same shape harder because it reads its runway for a failure decision. `forwardBufferMsAt` is the arithmetic `publish()` already did, lifted out so the two figures cannot drift. The clock offset still comes from the event, and must: core computed its request from that sample, so the two positions denote the same content by construction.

- **The failure screen reads out the failures core chained beneath the one on screen.** Core 0.14.0's `terminalRecoveryError` returns the failure that started a recovery and appends the attempt that ended it at the tail of the `cause` chain. This screen said only the head and dropped the rest, so a viewer reporting a failover reported the wrong node.

- **Everything leaving the player is whole milliseconds.** The survey the rounding fix in 0.17.2 deliberately deferred, with the rule applied throughout: anything crossing the wire or reaching storage is whole milliseconds, and the element's own clock keeps its precision. `durationMs` was published raw, and it reaches localStorage through Continue Watching and is the scrubber's `max`.

- **The viewer is told how long the node has been taking to start.** A spinner says only that something is happening. The three budgets bounding a start — negotiating a generation, waiting for its first fragment, starvation once a URL is attached — are sequential and nothing bounds their sum, so a cold node can spend the better part of a minute with every budget behaving exactly as written. Shown after five seconds; no run has yet taken that long under observation.

- **A cluster that refuses this client a session puts the viewer on the sign-in wall.** The backlog had this as a change to make core stop raising the connection gate on a refusal; core 0.14.0 already does, with the argument written into its source, so reading core first turned the item into its opposite and what was left was saying something useful to the viewer. Not reproducible on this cluster by waiting — an unauthenticated mint here succeeds with no roles, which is the other branch.

**Watched live: the two blackouts above, and nothing else in this release.** The rest landed with unit cover and a fault watched failing first, and each one's open half is recorded in `TODO/ACTIVE.md` rather than implied to be finished.

## 0.17.2

- **A seek keeps the picture up instead of going black while the node builds.** An out-of-buffer seek tore the media element down and left it at `readyState` 0 with nothing buffered and `paused` false — trying to play with no media, which is a black screen for as long as the node takes: 1.2 s on a fast remux generation, 10–13 s on a transcode. The frame the viewer left was thrown away the moment they asked to move. It cannot survive on the element hls.js is attaching to, because that element is handed a MediaSource object URL and attaching a new one resets it, so the replacement is now prepared on a second element while the outgoing one stays where it is, paused, and the two are swapped once the replacement can present the position actually asked for. This is not the design rejected for relocations previously: that one kept *playing* the outgoing generation, so the viewer watched 14.5 s of the previous scene with the clock already reading the destination. A frozen frame claims nothing. The pause is taken by the control the instant a seek is committed rather than when the replacement arrives, because core tells a player nothing about a relocation until `play()`, a whole negotiation later; it is released by whichever path core then takes — a buffered target reaches `player.seek()` synchronously and the hold is undone in the same tick without ever reaching a frame, an unbuffered one carries the freeze through to the swap, and a refused seek releases immediately. Watched live over seven seeks: five local, `picture-held` and `seek-local` on the same millisecond each time; two relocations where the picture was frozen 886 ms before the player was told anything, completing 1,568 ms after the seek, with paused spans of 1,600 ms and 2,000 ms that ended on the replacement rather than on black. The hold also stands down the stall watchdog, for the reason `pause()` already did: a countdown measuring "nothing is moving" cannot tell a freeze we asked for from a node that has died, and left running it ended a held seek in a failure screen 6,864 ms later while the node was still building the replacement it delivered at 9.5 s.

- **The generation clock stopped running backwards, and the readout stopped lying about where the picture is.** `WebMediaTimeline.establishOrigin` chose between its two branches on the requested position alone, and was wrong on the path taken most. The teardown path builds the timeline with a non-zero position but starts the loader at zero, and its initial-seek listener publishes before it seeks, deliberately, so the origin is established first — so the sample it learned from had `currentTime` 0, the residency guard passed, and the branch subtracted the offset from zero. The initial seek then targeted media time 0, playback began at the generation's own start and presented the pre-roll the seek contract says is never presented, and every position afterwards was reported `seek_offset_ms` too high for the life of the generation. The timeline is now told which case it is in — `generation-start` where the loader begins at the generation and the first resident timestamp is the origin, `requested-position` where hls.js's `startPosition` is set and `currentTime` genuinely is the requested position — as a required argument, so a new call site cannot inherit the wrong case silently. A negative origin is refused outright rather than encoded into every later mapping. Seen failing first at the teardown shape, reproducing the live figure exactly: `originMs: -18120`. Verified live on a resume rather than only a seek, which is the activation that reaches this with no seek at all: origin 0, the initial seek targeting 3,330.902 ms rather than 0, the element's first moving sample at `currentTime` 3.330902 s, and readout against picture over 318 samples at a mean of −132.6 ms within a −754 to +447 range, which is the scrubber's whole-second quantisation centred on zero rather than the constant offset the fault produces.

- **Positions leave the client in whole milliseconds.** `currentTime * 1000` is sub-millisecond, and it becomes the resume position and the `seekMs` sent back to a node, where the contract is integer milliseconds with no slack — core rounds the same way on its own wire. Asked for 2,018,389.921 ms a node answers with a generation starting at 2,018,390, core reads `absolute < generationStart` as "this generation begins after the viewer", refuses to activate, and re-asks with the same fractional number for ever: 25 identical rounds, no error raised anywhere, `player.play()` never called once, and nothing played at all. It bites only when the node honours the exact position and rounds up, which is a frame-accurate transcode, so it came and went. Whether the rounding is the whole of it is **not established** — nothing in the suite reaches this path — and where else a fractional millisecond escapes this repo has deliberately not been surveyed. Both are recorded in `TODO/ACTIVE.md` rather than guessed at.

- **`@machafoundation/core` is a `file:` link again, and that undoes something 0.17.0 established.** Core is `file:../macha-ts` so it does not have to publish for this client to build against its work, which is how the seek contract was developed across the two repos. 0.17.0 removed exactly this and its entry argues the case: a fresh clone with no `macha-ts` beside it can no longer `npm install`. The deployed artefact is a built bundle and is unaffected, but the repo's own installability is not, and it needs pinning back to a published version before that property is wanted again.

- **Still-frame-with-audio after a seek is understood and is not this client's.** Reported as a still picture near the new position with sound running for a few seconds before video joins, in sync. Measured across four swaps: video restarts when `currentTime` *arrives* at a point rather than after a fixed wait — 124 ms/0.062 s, 115 ms/0.046 s, 2,264 ms/2.208 s, 5,951 ms/5.888 s — while audio decoded bytes climb from the start, video decoded bytes sit frozen (95,980 unchanged for six seconds in the worst case), `totalVideoFrames` sticks at 5, `readyState` is 4 throughout and the buffer reports one contiguous range from 0 with no hole. A single muxed source buffer per generation, so the two tracks share one buffer. Remux on a long-GOP title where a bad draw lands 8.8 s from a keyframe is tight, because the server snaps back to a keyframe and both copied tracks begin there; a transcode session that copies the video while re-encoding the audio is asked to start on a frame the copied video cannot start on, so the sound begins at the requested position and the picture at the next keyframe. Raised with the server session rather than worked around here.

## 0.17.1

- **A paused title no longer declares itself dead.** Pause a title, leave it, and the player failed on its own with `Macha endpoint http://10.35.1.50:7438 failed: Failed to fetch`; pressing play recovered. Two independent detectors were judging a node with nobody waiting on it. Core's `MediaStallWatchdog` restarts its countdown on every advancing report and is armed until something disarms it, and `publish()` reports only while the element is playing — so pausing stopped the restarts and left the countdown running, firing 7001 ms after the last report before the pause, which is the budget exactly. Core had built `suspend()` for this case and the web player never called it. Separately, hls.js keeps filling its forward buffer through a pause, and on a node producing segments slowly its one permitted network restart was spent 21 s into a pause and the next fatal error tore the generation down at 130 s. `pause()` now suspends the stall watchdog, which core re-arms on the first report after the resume so a node that dies mid-pause is still judged the moment anyone waits on it again; and a fatal hls.js error raised while paused parks the load rather than being judged — `managedHlsErrorAction` gained a `viewerWaiting` argument and a `park-paused` action, `resume()` calls `startLoad` before asking the element to play, and no budget is spent. Keyed on viewer intent rather than the element's paused flag, because between a play request and the element actually running the element is still paused while the viewer is very much waiting. Both tests were seen red first, one with the live message verbatim. Verified live: 138 s paused and clean where the old code failed at 7 s, and again for 6 min 50 s with the tab hidden, which is the case that matters because hls.js keeps loading in a background tab.

- **A viewer stopped at a login is returned to the link they followed.** Somebody follows a link to a title, has no usable session, and gets a login — which is the correct answer. The redirect recorded where they had been heading and nothing ever read it, so a successful sign-in left them looking at the form they had just filled in. `postSignInDestination` finishes the journey, falling back to the account's own landing route when nothing was recorded. The destination rides in `location.state`, which a viewer can author through the History API, so it is trusted only as far as being a path this application could have produced: an absolute or protocol-relative URL would turn "sign in to keep watching" into an open redirect off the site.

- **A busy node is a node to wait for, not a stranger.** Server 0.43.0 answers `/api/v1/health` with `busy` and a `Retry-After` when its control lane's queue is full, alongside the `starting` and `failed` this already knew. It identifies the node exactly as the others do — which is why the refusal body keeps `service` and `status` — so treating it as "this address is not Macha" would put an endpoint form in front of a viewer during a load spike, on a node that is plainly there.

- **The player says why it had no facts to reason from.** "Chosen without facts — transcoding because nothing could be reasoned from" told a viewer nothing about whether their file is broken, their node is busy, or this client never asked, and what they meet downstream is a media error that reads like a corrupt download. Server 0.12.0's `factsError` is now read out in the same line. It is `unknown` by contract — whatever the facts supplier threw — so it is described rather than trusted, and an absent error stays silent: core states it is absent when there is no facts supplier at all, which is a configuration and not a fault.

- **Status stops repeating at cluster level what the node pages state better.** `conditions` arrives as free prose with no severity on the wire and the panel paints every entry amber, so "1 node accepts no inbound connections" — a permanent, intended topology — read as a fault at the top of Status on every visit. Styling it neutrally was the first attempt and was not enough: the line is still the first thing on the screen and still says nothing actionable. Conditions a node's own page already attributes to the node it concerns are dropped from the cluster panel rather than recoloured, and nothing is lost, because `Inbound RPC connections` on that page says more than the cluster-level count ever did. Anything unrecognised is still shown, and still amber: unknown is not benign.

- **The failure screen still names the wrong node, and that half is core's.** Any door into a failover ends in the same room: the failed node is excluded, the only remaining candidate is a discovered plain-http LAN address, an https page cannot fetch it, and the viewer is shown a node that was never serving them. That also explains the "random 'Failed to fetch' in a running stream which resolves if you press play" reported the same day. Recorded as the first P0 in `TODO/ACTIVE.md`; it needs core to keep an http endpoint out of the candidate list for an https page, and to carry the failure that started the failover rather than the last endpoint tried.

## 0.17.0

- **The client installs from a clone and an `npm install`, with nothing beside it.** `@machafoundation/core` was `file:../macha-ts` — a symlink into a sibling working directory — so this repo could not be set up by anyone who had only downloaded it, and `pretest` (`cd ../macha-ts && npm run dist:check`) failed outright without that checkout. Core is now `^0.11.1` from npm, and `pretest` is deleted: it validated a tree the client no longer compiles against, and a green check that means nothing is how a real one stops being read. Verified the way it will actually be met — a fresh clone with no `macha-ts` present anywhere installs with `npm ci`, typechecks, and passes all 335 tests.
- **The registry is now the only resolution path, deliberately.** No `npm link`, no `file:` override kept aside for development. A loop that resolves differently from the thing being shipped is how something reaches a release working only locally. When core needs a change in front of this client before a release it publishes a prerelease under a dist-tag and the client installs `@machafoundation/core@next` — same install path, same tarball shape, `latest` unmoved. The argument for keeping a fast local loop was weaker than it looked: three of the four defects credited to it (a stale `dist`, an orphaned build artefact, a mid-rebuild collapse) were failures *of the link mechanism* — a client reading a directory core was mid-write on — and none can happen against an immutable tarball with an integrity hash.
- **A dependency swap can silently not happen, and the obvious check agrees with it.** Editing the version and running `npm install` left the lockfile reading `"resolved": "../macha-ts", "link": true`: npm reused the existing symlink rather than fetching the tarball. Because the local tree was *also* 0.11.1, `require(...).version` answered `0.11.1` throughout and the suite passed — a green run confirming a swap that had not occurred. `test -L node_modules/@machafoundation/core` is the only check that cannot lie, and it is in the README. Reported to the `Macha NPM Core` session, whose other two clients have it worse: they are renaming `@macha/core`, so a stale link can survive under the old key while the new one resolves from the registry, putting two copies of core in one tree.

## 0.16.1

- **Keep the client out of search engines.** Now that a node serves this bundle at the root of a public endpoint, a crawler reaches it exactly as a viewer does. `robots.txt` disallows everything, and `index.html` carries `noindex, nofollow, noarchive` — both, because they do different jobs: `Disallow` stops a crawler *fetching* the page, and does not stop the URL being indexed from a link elsewhere, since a crawler forbidden to fetch it can never read a directive inside it. The meta tag is the half that says do not index, and every route gets it because they all fall through to the same index. Nothing here can cover non-HTML responses — an `X-Robots-Tag` on the API namespace is the server's to set, and has been raised with it.

## 0.16.0

- **A client served from a Macha node connects to it without being told.** With nothing configured, the client asks its own origin for `/api/v1/health` before it shows anybody an endpoint form, and uses that node if it answers as Macha. **The bar is the body, and it has to be:** this client's own deployment requirement is that the web host serves `index.html` for unknown application paths, so a host serving this bundle and *not* running Macha answers `200` for the liveness route too — anything keyed on `response.ok` adopts that host and then fails every API call against a pile of HTML. Confirmation needs a JSON content type, a `status` of `ok`/`starting`/`failed`, a body that agrees with its own status line, and `service` — when the node sends one — equal to `macha`. The test was watched failing first: against a status-only check six of fourteen go red, including that exact case. All three health states adopt the node, because identity and readiness are different questions and refusing `starting` would send a viewer who powered on their server and their television together to a form seconds before the node starts answering. Bounded at 1.5 s rather than core's 4 s connection check — that budget belongs to somebody waiting on a decision they made, this one is spent before anyone asked for anything. Packaged builds derive nothing: Samsung and Android load from `file:`, where the origin is not an address, and Samsung is pinned to build-time endpoints anyway. The confirmed origin is seeded like discovered membership, never written where configuration is read from, so the Connection field still shows only what a viewer typed and a bundle later served from a different host cannot inherit an endpoint nobody chose;
- **the server now says what it is, because the old answer could not.** `/api/v1/health` returned `{"status":"ok"}` and nothing else — 15 bytes, measured against the deployed cluster, no product and no version — which is also what a router admin page, a k8s probe or an nginx stub produces. A parsed body was strong evidence and never proof. Server 0.42.1 adds `service: "macha"`, built unconditionally in the single return that serves all three states so it cannot go missing from a 503. This client asserts it conditionally — absent tolerated, present and wrong refused — so nodes that drift apart in version keep working and no flag day is needed. The route still carries no node id, no topology and no capacities, held there by tests on the server's side. A node older than 0.38.5 has no liveness route and answers `401` rather than `404`, because authentication runs before routing, so it is simply not adoptable and the endpoint screen appears exactly as it does today;
- **Status stops warning about a normal topology.** `conditions` arrives as free prose with no severity on the wire and the panel painted every entry amber, so "1 node accepts no inbound connections" — permanent and intended — read as a fault every time the screen was opened. A panel that cries wolf about a standing state is worse than one that says nothing: it trains the reader to skip the row that will one day carry something real. That condition now renders in the neutral palette; anything unrecognised keeps the amber, because unknown is not benign. Matching the sentence rather than a severity is not good, and is noted as the server's to fix if it ever becomes worth a release;
- **a node states whether it accepts inbound RPC connections, on its own line beside its RPC address.** Yes, No, or an em dash for a node that did not report the field — which is not the same as a No. **Two derivations were tried first and both were confidently wrong about the one node in this cluster the line exists for.** Deriving it from `api_endpoint` conflates two planes: the API endpoint is the HTTP URL a *client* dials, inbound capability is whether *peers* can dial the RPC plane, and `corvus-fi-1` reports `inbound_capable: false` while advertising `http://10.35.1.50:7438` — a LAN address a browser in that building uses happily and that is dead from anywhere else. Explaining the failover pool with the flag is the same error in reverse: fi-1 is a discovered endpoint and a legitimate failover target for a client on its network. The row reads `inbound_capable`, which is the field the cluster's own `nodes_inbound_incapable` counter counts, so the node page and the cluster condition cannot disagree about which nodes they mean. Measured live on 0.42.1; core's `ClusterNodeStatus` does not declare the field yet, so it is read through a narrow cast that goes when core adopts it.

## 0.15.0

- **Posters stop re-downloading, and the cause was the one part of an artwork URL that is not the content.** Reported as images that "load slowly, and when 'cached' they're just less slow. Changing anything or waiting for a minute or two, and they all load from scratch again." Measured against the deployed cluster rather than reasoned about, and both of the obvious suspects were wrong: the signature does not churn — two catalogue reads a second apart returned 418 artwork refs with 418 identical URLs, `exp` pinned to a UTC day boundary and the same value for every object — and `Cache-Control` was already `public, max-age=86400, immutable` on every node, so no server change was needed. What varied was the **host**. A browser's cache key is the whole URL, an artwork capability's signature covers the id and the expiry and never the host, and the preferred endpoint moves on a 10 s probe cycle — so every pre-emptive swap silently renamed every poster in the catalogue. Caught live: a `preemptive-endpoint-swap`, then 29 visible posters re-fetching at 2.7–3.0 s each, while the identical artwork id under the previous host answered in 3 ms from disk. The bytes had never gone anywhere. `@machafoundation/core` now promotes whichever node last served artwork, and this client reports successful loads through `noteArtworkLoaded` and reports nothing on failure, so a single 404 — a normal event while artwork replication is incomplete — cannot move the preference. A reload of the Movies grid now issues no artwork requests at all;
- **posters that had already loaded but were never drawn.** Blank cards on a full grid were neither missing nor slow: every visible image reported `complete` with real pixels at every sample from the first frame, the bytes decoded to a bright, detailed JPEG, and nothing covered them — the browser simply never scheduled a raster. The tell was which interventions fixed it: anything that dirtied *paint* on the element worked, while a scroll or removing 185 sibling cards did not. The trigger was ours, and it is the same fault as above — `<img key={url}>` meant a swap destroyed and recreated ~200 elements at once, firing ~200 simultaneous decodes, some of which landed with the paint invalidation dropped. `decoding="async"` is gone from the capability image; with the host no longer churning, the storm that provoked it does not happen either;
- **records are listed compactly and edited in a dialogue**, as one design language rather than a preference per screen, documented in `docs/architecture.md` and applied to Users. A row carries identity, a one-line summary and an overflow menu, and **no inputs**: an editable field in a list is a control the viewer can change without meaning to, it makes every row as tall as its longest form, and it forces each row to carry its own busy, dirty and error state. Mutations open a `FormModal` or a `ConfirmModal` which owns the form, the busy state and the failure, and stays open when the server refuses, because a dialogue that closes on failure takes the only explanation with it. The row itself is the edit control — on a remote, a separate "Edit" button beside a name that does nothing costs a D-pad stop to reach the half that works — and setting a password is its own dialogue rather than a field in the edit form, because it signs that account out everywhere and burying it mid-form is how somebody does it by accident;
- **`VolumeStore` is this client's own again**, moved out of `@machafoundation/core` to its two real consumers. The storage key is unchanged, so no viewer lost a volume and no migration was needed. `Platform.initialVolume?` stays in core, because whether a host owns app-level volume at all is the genuine cross-client fact — a television's volume belongs to the television. One behaviour changed deliberately and in both clients at once: `Number('')` is `0` and `0` is finite, so an empty stored entry was read as a deliberate mute, which is exactly the "comes up silent with nothing explaining why" failure the store exists to prevent. An empty or whitespace-only entry is now read as absent; a stored `0` still means silence, because that is a choice a viewer made;
- adopt `@machafoundation/core` 0.11.0, which carries both the artwork host preference above and the removal of `VolumeStore`, on top of 0.10.0's session model — a session now persists and is validated on reload rather than an anonymous one being minted at every cold start, so a tab no longer owns its own session and signing out revokes rather than silently replacing. This client compiles and passes against it and references none of the renamed symbols; it is **not yet ported** — `AccountMenu` still revokes through `api.logout()` rather than `sessionManager.signOut()`, and `lastIdentityChange` is not subscribed. That work is scoped in `TODO/ACTIVE.md` together with the reason it is not mechanical: this cluster's anonymous account holds no roles, so a session that ages out and re-mints leaves a viewer unable to read the catalogue at all, which presents as an empty client rather than as a sign-out.

## 0.14.0

- **Matroska plays as it is, instead of being rewrapped for no reason a decoder would recognise.** This client excluded the container outright, and the exclusion was written for a real fault — the Samsung accepts Matroska and renders corrupt video — but the cause was `matroska,webm` being read as WebM, which core now resolves to one container family. The exclusion had become a falsified capability outliving its reason, and it cost 23% of the library. `canPlayType` is still not taken at its word: the probe requires an engine to *refuse* an impossible codec in the same container before it will believe a yes, which is the discipline `hlsDeliveryProbe` already applies and turns "this host's oracle lies" into something each host demonstrates about itself. Measured against 1004 items on gbni-1: the whole `container-not-playable` remux bucket — 153 titles with both streams already `copy` — became direct play, and not one title in any other bucket moved;
- **a login wall for deployments where only registered users see media.** Take `media_viewer` off the `anonymous` account and the session arrives holding an empty role list, which is the server being explicit rather than silent, and the client puts a login in front of the application instead of beside it. Never while something is playing: the wall is raised from a re-read of the session and a re-read happens on every re-mint, which is what failover does — tearing the player down on it would turn a node dying mid-film into a black screen, and revoking a role bumps `credential_generation` and stops the stream at the server anyway. Settings → Connection stays reachable from behind the wall, with a link to it, because a viewer whose cluster stops granting roles can otherwise neither sign in nor leave, and on a television there is no address bar to fall back on;
- **every navigation section states the role it is worth showing for**, and the routes are gated to match — hiding a link is not access control, because a bookmark, a Back or the catch-all all reach a route with no nav involved. Home is included: it is a catalogue screen despite not looking like one, and leaving it ungated is what met an account without `media_viewer` with a wall of 403s. An account refused a section lands somewhere it can actually use rather than on Home;
- **Status has its own role, `view_status`, rather than borrowing `manager`.** The capability is "see the health of this cluster", and neither existing gate said that: `manager` took the diagnostic screen from an ordinary viewer at the moment it earns its place, and ungated showed it to a session granted nothing. Liveness, ranking, failover and the connection gate all run off `/api/v1/health`, which needs no session and no role, so withholding it costs the Status screen and nothing else;
- **the node card carries the server version.** This cluster is deliberately not uniform and drifts apart in practice — one node sat on 0.38.1 while the others moved to 0.38.4 — and "which node is behind" is the first question when one of them behaves differently. Having to open each node in turn to compare a version is how that goes unnoticed;
- **the account identity is the control**, rather than an inert username-and-icon chip sitting beside a `⋯` button: two adjacent targets for one idea, an account icon that looked pressable and did nothing, and an extra D-pad stop on a remote to reach the half that worked;
- **fix a logout warning that was not true.** It said the session ended "everywhere, not just on this device". `logout()` is `DELETE /api/v1/session`, which revokes one token — verified by minting two sessions for one account and revoking one while the other kept answering. Signing out everywhere is what a password or role change does. Telling someone their other devices are signed out when they are not is the kind of wrong that stops them doing the thing they actually needed;
- **say why a sign-in was refused in words a viewer can act on.** `Could not start a session: 401` is the transport's sentence, not the situation's. One message covers a wrong password and an unknown username alike, because the server answers those identically and in the same time so that nobody can discover which accounts exist by watching the replies; anything that is not a refusal keeps its own wording, so an unreachable node does not send someone hunting for a typo;
- **a successful login no longer leaves you on the login screen.** The token is live at once but the roles are not, so navigating in between was judged against the session just replaced and bounced straight back. Signing in now returns the viewer to the page that sent them there rather than to Home;
- **do not offer a password change for an account that holds no credential.** Rendered from the server's own `mutable.set_password`, never from the username, and an absent block is read as "this node does not say" rather than as a refusal;
- session role policy moves into `@machafoundation/core` — `sessionPermits` and `sessionLockedOut` take `roles | undefined`, so "unknown is not none" holds by construction rather than at each call site, and four clients answer it identically. The client's whoami retry went with it: roles ride the token now, stated by whichever path produced it, so there is no separate fetch left to fail;
- take `EndpointCandidate.ready` from core for the endpoint cooldown state instead of comparing `retryAt` against `Date.now()`. That comparison was correct only because this application injects a wall clock into the registry, which is a property of how it was constructed rather than of what `retryAt` means;
- drop a decommissioned machine from the Android build's endpoint list, where it was the first endpoint tried at boot.

## 0.13.0

- **accounts, roles and login**: a login screen and a quiet account marker in the top bar, with user details, change password and a confirmed logout that revokes the session cluster-wide rather than only forgetting it locally. Login is `@machafoundation/core`'s: the screen collects two fields and the session manager exchanges them on the same route, with the same response shape, as the anonymous mint — one session lifecycle rather than two;
- **a Users screen for accounts, roles and passwords**, under Manage and gated on `manage_users`. Every control is enabled from the server's own per-field `mutable` block rather than a name check, so `root` and `anonymous` lock correctly without this client knowing anything about them, and a roles lock caused by the last-manager rule says so instead of greying out silently;
- **roles decide what is visible**. Stated roles are literal and no account is special-cased: a capability the server did not name is one the session does not have. A node that cannot answer leaves roles *unknown*, which is not the same as having none, so sections that predate roles stay visible against an older node rather than vanishing for everyone;
- **Settings leaves Manage for its own top-level section**, reached by a cog beside the account marker. It is client-local configuration that no role gates, and grouping it under a privileged section hid it from the people most likely to need it — anyone who cannot reach a node has no roles either, and the endpoint list is the one thing that would fix that;
- **fix a bootstrap lockout: saving an endpoint could never succeed**. The connection form probed an unauthenticated `catalogue/status` before saving, which every node answers 401, so no typed endpoint qualified and none could be saved — and with no endpoint there is no session, so nothing could ever validate one. The probe is gone rather than repaired: reachability is a fact the health monitor already maintains and the mint already walks candidates to find, so saving is now just configuration;
- **artwork fails over between nodes instead of vanishing**: a poster whose signed capability URL will not load now tries the same capability on the next node immediately, and then the authenticated fetch, rather than showing a blank card for sixty seconds. An artwork capability is a cluster credential — its signature covers the artwork id and expiry, never the host — and artwork is content-addressed, so any node serves the same bytes; an expired one is offered once, in case the browser still has the image cached under it, and to no other node;
- open a torrent's detail pane by clicking it on the Import screen: transfer and share ratio, info hash and owning node, age and last change, the linked import job's files and destinations, and the cataloguing outcome the server has reported since 0.28.1 and this client ignored;
- move `MediaStartWatchdog`/`MediaStallWatchdog` into `@machafoundation/core` (0.7.0) and keep only `src/platform/mediaWatchdogEnvironment.ts` here, which is the whole of the DOM in that mechanism;
- stop forcing native HLS on Android TV: WebView 151 has MediaSource, and hls.js gives that target the degradation channel the native path never had;
- detect audio that has stopped decoding while video continues, from `webkitAudioDecodedByteCount`/`webkitVideoDecodedByteCount`;
- flatten object console arguments to JSON on the Android build so logcat stops printing `[object Object]`;
- hold `AUDIOFOCUS_GAIN` and set `FLAG_KEEP_SCREEN_ON` in the Android WebView shell, yielding on focus loss by pausing the page's media;
- take `formatPlaybackTime` from `@machafoundation/core` and delete this client's copy;
- state what the scrubber's duration must be instead of relying on `||`, which skipped `NaN` only because `NaN` is falsy and let `Infinity` through to the formatter;
- record what Tizen 3 actually provides, measured on the set rather than inferred (`TODO/ACTIVE.md`).

## 0.12.2

- move failover off a stalled node in 7 s rather than 15 s, calibrated to outlast the server's own 6000 ms segment hold rather than picked independently;
- remove the manual bearer token from every interface; the anonymous session is the only auth path;
- stop text fields trapping D-pad focus — up and down leave the editor for the previous or next control;
- make inferred metadata candidates selectable, and hide candidates already in the catalogue;
- add a Settings switch for extended playback logging on the error screen, default off;
- colour-code telemetry age on the node cards and node detail (amber past a minute, red past five).

## 0.12.1

- **Samsung failover plays**: a replacement generation now restates the segment container it was created with, so a recovery node no longer serves fMP4 to a set that asked for MPEG-TS (`@machafoundation/core` 0.6.3);
- name the endpoint in the "Preparing stream" message so a failing recovery says which node it is waiting on;
- report cores and system memory on the node cards.

## 0.12.0

- take a baseline before judging: a source that has never started has not stalled. Arming the stall watchdog on a freshly promoted generation's first report killed every replacement and exhausted the cluster with healthy nodes in it.

## 0.11.1

- bound playback that never starts and playback that silently stalls;
- serve Samsung segments rather than files;
- stop a held segment counting as node failure;
- feed media bytes into endpoint throughput.

## 0.11.0

- turn router transitions off so presentation and playback land together;
- queue the season for a lone episode;
- bound HLS recovery;
- state the whole transform on a mode press.

## 0.10.7

- **Samsung HLS fixed by MPEG-TS segments**: prefer TS carriage on Tizen 3, where fMP4 breaks HEVC and all audio, and render the segment-container reason.

## 0.10.6

- **the client negotiates playback**: the chooser moves to `@machafoundation/core`, fed by server facts and operations;
- probe HLS delivery codecs;
- move the API layer to `@machafoundation/core`.

## 0.10.5

- resolve episode ancestry in the API;
- hold the session fetch for a mint and retry on 401;
- drop the call-site `sessionReady` gates.

## 0.10.4

- bound the initial session POST;
- stop a failed seek pinning the scrubber.

## 0.10.3

- remove demo mode and its sample-mp4 asset.

## 0.10.2

- bound fetch timeouts;
- fix a seek race in `fail()`;
- give the endpoint registry reload memory.

## 0.10.1

- persist and validate the anonymous session across reloads instead of re-minting;
- fix a deep-link session race and early-401 session clobbering.

## 0.10.0

- migrate the session/auth REST contract: anonymous session lifecycle, legacy viewer/idempotency headers dropped;
- any-node failover fixes.

## 0.9.1

- stop a redundant transcode session being created alongside a restarting seek.

## 0.9.0

- **any-node failover**: cluster discovery, seamless mid-stream swap, endpoint health fixes.

## 0.8.3

- artwork capability URL fixes;
- node phase status UI;
- further any-node failover work.

## 0.8.2

- move to the standard React testing framework; test hooks and effects.

## 0.8.1

- media info precache and reuse;
- rollup of in-flight fixes, and the first Android target.

## 0.8.0

- alternate sources; API and media hot-swapping.

## 0.7.7

- preload the single canonical logo asset while keeping the application modules eagerly bundled, and harden intermittent poster loading with longer bounded transient retries, invalid-response rejection and browser decode recovery;
- add a first-class Status section with live cluster health, known-versus-online durable/cache capacity, metadata quorum state and per-node telemetry;
- add node detail views with runtime, storage, metadata and peer/RPC observations plus cluster/node connectivity re-check actions;
- move Settings beneath Manage as a route-backed management tab while preserving direct navigation for server-unreachable recovery and Samsung back navigation;
- add cluster-wide stale endpoint/IP → NodeId reset controls to Status, with explicit destructive confirmation and no deletion of persisted node/MachaDFS state;
- move the routine node identity reset action directly onto each Status node card, keeping the general management API capable of host/IP-only resets while removing the free-form reset panel from the frontend.

## 0.7.6

- add a Retry import action for downloaded torrents whose linked ingest job failed, reusing the server-side staged payload rather than starting the torrent again;
- wire the torrent retry action through the acquisition API client while retaining Pause/Resume as distinct download controls.

## 0.7.5

- render the active player's current buffered media-time ranges directly in the full seek bar, using a near-white light pink background for resident ranges and preserving disjoint ranges on both sides of the playhead;
- make the played portion of the seek bar slightly translucent so buffered residency remains visible underneath already-played media, while keeping the thumb opaque and controls fully interactive;
- publish buffer-state changes on media progress, completed HLS fragment appends and HLS buffer flush/eviction events, while suppressing duplicate player snapshots so buffer visualization adds negligible steady-state UI work;
- clip and merge reported buffered ranges before rendering to bound DOM segment count after repeated seeks, with regression coverage for disjoint/back-buffer ranges, clipping/merging and duplicate-event suppression.

## 0.7.4

- replace the previous cancellable/prioritised lazy-artwork stack from scratch with a monotonic viewport-demand model: once artwork approaches the viewport its fetch is allowed to finish and scrolling away can never revoke that demand;
- remove the custom artwork request scheduler, request priorities, scroll-driven AbortController cancellation and reversible IntersectionObserver state, leaving browser HTTP scheduling and `MachaMediaApi` request coalescing/cache as the only network concurrency mechanisms;
- use one application-wide scroll/resize proximity registry with a 1000 px preload margin and one animation-frame geometry pass for all pending cards, including nested horizontal/vertical scrolling and an eager/non-browser fallback;
- add regression coverage for vertical and horizontal preload geometry, one-shot/monotonic viewport triggering, and shared artwork request coalescing/cache behaviour.

## 0.7.3

- make terminal playback failure an actionable state rather than a dead end: Play now retries the failed playback intent and changing mode/quality/audio/subtitle after failure acquires a fresh source generation instead of silently PATCHing a released session;
- allow playback-session creation to carry explicit initial preferences, so choosing `Transcode` (or another mode) after failure is honoured on the new POST before any source is attached rather than briefly re-entering `Auto`;
- preserve the failed generation's last playback position and preferences across explicit retry while retaining the single-owner teardown barrier, and present the transport control as Play after failure;
- add regression coverage for explicit-mode retry, Play-to-retry, initial preference propagation and failed-player transport presentation.

## 0.7.2

- bound managed Web HLS media recovery per source generation so repeated fatal MSE/SourceBuffer failures cannot recurse indefinitely through `recoverMediaError()`; a recovery must produce real timeline progress before another is permitted, with a hard per-generation ceiling;
- add an explicit terminal player-failure channel from `Player` through `PlaybackCoordinator` into `PlaybackRuntime`, so unrecoverable HLS failures enter the existing failed state and immediately tear down the owned playback source/session instead of leaving a live failed generation;
- preserve detailed hls.js SourceBuffer diagnostics (`details`, source buffer, MIME type, reason and underlying error) in the client trace, and add regression coverage for recovery budgeting, seek-discontinuity handling, failure propagation and lease cleanup.

## 0.7.1

- move playback lifetime out of React presentation components into one application-scoped `PlaybackRuntime` state machine that exclusively owns the platform player, coordinator and server playback-session lease;
- serialize resource-changing playback generations so replacing an item cannot create a new server session until the previous generation has completed teardown, including sessions whose POST resolves after Stop;
- make player-host mount/unmount presentation-only, allowing full/mini player transitions and React remounts to rebind the same player surface without destroying or renegotiating playback;
- make final queue EOF terminate the owned playback lease, keep persisted queue/progress as resumable history rather than automatically resurrecting playback on ordinary startup, and use keepalive DELETE teardown on browser page exit;
- suspend managed Web HLS loading while paused and restart acquisition on resume, so a paused transcoded stream does not continue filling its large forward buffer and touching the server session;
- fix artwork lazy-load cancellation so obsolete in-flight requests are genuinely aborted and scheduler concurrency reflects real browser requests rather than released logical slots;
- add playback-runtime, coordinator teardown and resolver keepalive regression coverage around single ownership, late session creation, ordered replacement, fatal source cleanup and page-exit teardown.

## 0.7.0

- replace the accumulated player-screen seek/reload state machine with one playback coordinator that owns user intent, active source generation and coalesced server representation changes; transport controls never wait for source-generation work;
- make Direct and in-generation Web HLS seeks purely local transport operations, with server seeks reserved for transformed targets outside the active immutable generation;
- keep the current source playing while replacement generations are prepared, then apply the latest position/play-pause intent when the newest generation is ready;
- prefer hls.js/MSE on modern Web with a bounded 60-second forward buffer so nearby seeks normally stay inside browser memory, retaining native HLS for the Samsung legacy target;
- make Web source attachment non-blocking: media `play()` readiness is observed rather than awaited by application orchestration, eliminating decoder/network readiness as a control-state lock;
- make Direct Play read-ahead setup opportunistic and non-blocking, cache demand bytes as they stream, and keep speculative fetches subordinate/preemptible;
- mount React immediately while the boot splash runs as a presentation overlay instead of deliberately delaying application startup;
- remove emitted JavaScript duplicates from `src` and generated Vite/TypeScript outputs, making TypeScript the single executable source of truth;
- add coordinator-level regression tests for Direct/HLS local seeks, keyframe-aligned startup, source-preparation coalescence, controls during server work and non-blocking source attachment.

## 0.6.9

- keep player controls live during startup, seeks and representation changes: play/pause and pre-start seek intents are applied to the eventual stream, while overlapping seek/option changes are coalesced and serialized instead of disabling the UI;
- make Web Left/Right seek -/+10 seconds, including when the progress or volume range control has focus, while preserving native arrow editing for text/select controls;
- always expose the server-advertised Audio section and show the resolved audio processing state (copy/transcode/output codec) independently from video;
- treat a user pause that aborts a pending Web `video.play()` as an intentional state transition rather than a playback failure.

## 0.6.8

- make Web Direct Play viewer demand bypass the read-ahead scheduler entirely: exact browser byte ranges now stream from the upstream response as bytes arrive instead of waiting for an 8 MiB cache chunk to complete;
- keep speculative read-ahead disabled during container bootstrap and seeking, enabling it only after established playback and a short demand-quiescence interval;
- abort active speculative fetches immediately when new viewer demand arrives, preserving the invariant that read-ahead can never delay current playback demand;
- treat each seek as a new read-ahead generation while retaining old resident ranges until normal eviction, so nearby/back seeks can still hit memory without continuing to invest in the old playback location;
- extend Direct Play diagnostics with demand first-byte latency, demand/prefetch byte and fetch counts, prefetch aborts, playback mode/generation, and an explicit zero-by-design demand-blocked-by-prefetch metric;
- handle Service Worker source release and browser cancellation without leaking the previous read-ahead AbortError as an unhandled FetchEvent rejection.

## 0.6.7

- always expose Direct next to Auto in playback mode controls on Web and Samsung, regardless of capability-derived server mode options;
- treat an explicit Direct selection as a user override and send `preferences.mode = direct` even when Direct was omitted from `options.modes`;
- continue deriving Remux and Transcode availability from the server.

## 0.6.6

- remove the in-app volume control from Samsung builds and keep the HTML media element at unity volume, leaving TV volume/mute to the remote and platform;
- make the full-player progress bar display-only on Samsung so D-pad navigation cannot select or scrub it;
- force Samsung HTML5 HLS playback through the TV's native HLS path instead of hls.js/MSE on Chromium 47, reducing client-side playback work and restoring the platform AAC audio path;
- exclude the real hls.js implementation from Samsung bundles while keeping normal Web HLS probing and hls.js fallback unchanged.

## 0.6.5

- remove Samsung AVPlay from the active Tizen build and restore the shared HTML5/Web playback path;
- constrain Samsung playback negotiation to H.264 + AAC in MP4/fMP4/HLS at up to 1920x1080, with no DASH/HDR/native-only codec claims;
- preserve automatic playback intent on Chromium 47, including legacy `HTMLMediaElement.play()` runtimes where `play()` does not return a Promise;
- add an explicit Samsung D-pad input adapter with old key-name/keyCode handling, repeat suppression, visibility-aware focus targets and row/column-biased spatial navigation;
- keep the Samsung mini-player at the existing 76 px height, including its video preview, instead of allowing the legacy full-player rules to expand it over the screen;
- reduce Samsung-only UI cost by disabling animation/transitions, expensive blur/shadow effects and verbose playback diagnostics;
- keep the normal Web build, capability probing, navigation and diagnostics behaviour unchanged.

## 0.6.4

- fix the Samsung/Tizen 3 compatibility stylesheet overriding the 76 px minimised player into a full-screen fixed layer;
- preserve the minimised player geometry explicitly on Samsung: 76 px total height, 132 px video preview, and the mini controls occupying the remainder of the same bar.

## 0.6.3

- introduce an explicit Web Direct Play desired seek position so repeated/held skip input accumulates from the latest user target instead of stale media-element time;
- coalesce Direct Play media-element seek mutations to a bounded cadence while keeping the progress UI on the latest desired target and preserving the three-second delayed spinner semantics;
- make seek-only session updates preserve active subtitle selection/language and subtitle resource continuity so Direct Play and transformed seeks cannot implicitly clear subtitles.

## 0.6.2

- make Web full-player Left/Right arrow keys seek backward/forward by 10 seconds, without stealing arrow-key input from sliders, text controls, or modified browser shortcuts;
- delay seek spinner feedback until a seek has remained unresolved for three seconds, avoiding loading flashes for fast seeks and Direct Play read-ahead cache hits;
- track Web Direct Play seeking/buffering state so a slow optimistic seek shows the spinner after the grace period and clears it only once the media element has actually resumed (or resolved a paused seek).

## 0.6.1

- make Web Direct Play seeking optimistic: move the browser immediately without waiting for playback-session mutation or forcing a pause/resume cycle;
- asynchronously synchronize Web Direct Play seek position back to the server with a short latest-wins debounce and serialized PATCHes, preventing rapid scrubbing from racing older session updates;
- keep remux/transcode and native Android/Tizen seek behaviour unchanged, and discard queued Web Direct Play seek mutations when another representation/session update supersedes them.

## 0.6.0

- add a Web-only Direct Play rolling read-ahead cache implemented as a transparent Service Worker byte-range proxy, preserving native browser demux/decoder behaviour for containers such as Matroska;
- fetch Direct Play media in 8 MiB chunks with a 64 MiB target read-ahead window, 96 MiB resident cap, two-request upstream limit, and demand-over-prefetch scheduling;
- keep the read-ahead cache memory-only and release it when the active Direct Play source stops or changes, with automatic fallback to the original media URL when Service Workers or upstream range reads are unavailable;
- expose Direct Play read-ahead diagnostics including resident/ahead bytes, fetched/served/cache-hit bytes, upstream throughput, concurrent fetches, and demand wait time/count so playback stalls can be distinguished from demux/timestamp problems.

## 0.5.7

- lazy-load card and episode artwork near the viewport through two shared intersection observers and a six-request scheduler, prioritising visible artwork, coalescing duplicate IDs, and cancelling queued work that scrolls away;
- add a reusable top-right card dismiss control and use it for Continue Watching and import/torrent jobs, replacing Continue Watching's overflow-menu Remove action;
- add a reusable centered contextual lower navbar at the application-shell level, with Music providing Artists, Albums, Tracks and Playlist across all Music routes;
- order Home Movies, TV Shows and Music newest-first using the catalogue `updated_ns` chronology signal currently exposed by the server;
- make import/torrent job X removal clear terminal server jobs, and require confirmation before cancelling and clearing active work;
- follow linked ingest lifecycle state on torrent cards so completed imports show Imported into Macha instead of the stale downloading/importing handoff message, including the cataloguing state where supplied.

## 0.5.6

- make album selection consistently open the album track listing from Music and Artist album grids instead of starting playback, matching the existing Search result behaviour;
- add an album-detail Play all action that replaces the client-local saved playlist with the album tracks in album order and starts playback from track one;
- keep Add to playlist as an append operation, distinct from Play all.

## 0.5.5

- rename the user-facing Ingest UI to Import while preserving the existing ingest route, API, job types and internal identifiers unchanged.

## 0.5.4

- add an Ingest page for server-side file/folder imports and BitTorrent magnet acquisition;
- show live ingest and torrent state, progress, transfer/copy rate, ETA, peer counts where applicable, and staging-area usage;
- add pause/resume controls and a destructive Delete action mapped to the server cancel operation;
- represent torrent-backed catalogue import as the same torrent row, switching from BitTorrent transfer metrics to generic ingest/copy metrics once the server hands the payload to ingest;
- preserve the 0.5.3 Music/Playlist and volume-control architecture while adding acquisition as an independent API and route.

## 0.5.3

- refactor Music into Artists, Albums, Tracks and Playlist sub-navigation, with grid browsing consistent with the Movies and TV catalogue pages;
- add a client-local persistent music playlist with album/track insertion, shuffle/play controls, drag-handle and keyboard reordering, duplicate entries, and per-entry removal;
- add shared music overflow actions for Add to playlist, Play next, Play later, Shuffle and detail navigation while keeping Play now as the default album/track action;
- extend the persistent playback queue with insert-next and append operations so music queue actions do not replace the item currently playing;
- add global track catalogue browsing through the existing catalogue list API;
- add a persisted volume control to the full and mini player bars for all media, backed by the common Player contract and the Web/Samsung platform players.

## 0.5.2

- add unobtrusive per-entity metadata editing for movies, series, seasons, episodes, artists, albums and tracks, including editable descriptive fields and preferred artwork selection when multiple stored images exist for a role;
- add Clear Metadata as a destructive reset that removes the catalogue match so the underlying media can be catalogued again;
- preserve the active subtitle stream explicitly across server-backed seek generations so a seek cannot silently reset subtitle selection to Off;
- prevent the `/play/...` route restoration effect from resurrecting a playback session that the user explicitly closed, so the close button tears the player down instead of leaving it running as the mini-player.

## 0.5.1

- finish the Web segmented-WebVTT runtime path so subtitle manifest URLs are fetched as manifests rather than handed directly to `<track>` as if they were VTT files;
- fetch and browser-parse only the previous/current/next subtitle segments, merging their cues into one stable display track so prefetch tracks cannot render duplicate or competing cues;
- explicitly activate temporary text tracks in hidden mode before waiting for browser parsing, and clean subtitle cues/listeners deterministically on selection changes and player stop.

## 0.5.0

- consume Macha segmented-WebVTT subtitle manifests on Web, loading only a small temporal window around current playback instead of one whole-file subtitle sidecar;
- keep the minimized Now Playing bar at a fixed 76 px height across Web and Samsung layouts;
- switch WebVTT subtitle tracks in place without seeking, reloading, or replacing the active video/audio source;
- send subtitle-only playback PATCHes without the current playback position so the server can keep the active A/V generation intact;
- report subtitle loading separately from representation changes and leave platforms that cannot replace subtitles in place playing uninterrupted rather than silently restarting media.

## 0.4.9

- Release an already-created Macha playback session immediately when native player startup fails, so a failed AVPlay prepare cannot strand a transcode reservation.
- Advertise Samsung AVPlay Matroska support so compatible MKV sources can negotiate Direct Play instead of unnecessarily entering remux/transcode.
- Constrain the Samsung legacy player chrome to its content height while retaining bottom anchoring, fixing the playback bar expanding over the full screen.

## 0.4.8

- Samsung builds now use the native AVPlay pipeline instead of Chromium 47 HTML5/HLS.js playback.
- Advertise native Tizen decoder capabilities to the playback resolver.
- Reduce AVPlay initial/resume buffering to four seconds for LAN VOD startup.
- Pin Samsung full-player chrome to the bottom with Tizen 3-compatible CSS.

## 0.4.7

- Harden the Samsung/Tizen 3 build: force its build-time server endpoint over stale local storage, add deterministic five-button remote selection, and ship a dedicated Chromium 47 layout stylesheet.
- Show `SAMSUNG TV` in the top-right platform badge for Samsung builds only.
- Scope the generated Tizen network access policy to the configured Macha HTTP endpoint.

## 0.4.6

- Add Tizen 3.0 / Chromium 47 CSS fallbacks to the Samsung-only build.
- Make TV directional/Enter navigation work with legacy Samsung key reporting and visible `:focus` styling.
- Avoid legacy `Headers(init)` and `URLSearchParams` constructor signatures in Macha HTTP requests.

## 0.4.5 - 2026-08-18

- make the Samsung build safe for Chromium 47 DOM APIs used during boot, artwork loading, TV focus scheduling, and HTML5 playback host management;
- show Samsung-only fatal runtime failures on screen instead of leaving a silent black application window.

## 0.4.4 - 2026-08-18

- add an isolated `build-samsung` Vite mode targeting the Chromium 47 engine used by 2017 Samsung Tizen televisions, emitting legacy-only JavaScript without changing the normal modern web build;
- use hash routing only in Samsung packages so packaged widget navigation does not depend on HTTP history fallback;
- generate the Tizen `config.xml` as build output rather than maintaining a second Tizen source tree;
- add `npm run install-samsung` to build, Samsung-sign, install and launch the widget on the configured development TV.

## 0.4.3 - 2026-08-18

- route episode playback from season rails through the canonical persistent-player entry point, preserving the actual season page as the return location instead of falling back to the generic episode route;
- allow generic episode detail pages to use episode still/thumbnail artwork when no backdrop or poster is available;
- retry transient artwork fetch failures with bounded backoff while avoiding retries for permanent client-side HTTP errors and cancelling pending retries when artwork is no longer needed.

## 0.4.2 - 2026-08-18

- keep failed playback mounted in its current full, fullscreen, or mini presentation rather than implicitly navigating, exiting fullscreen, or clearing the queue;
- keep recovery controls visible after fatal playback startup failures, with an explicit Close control in the full player;
- show fatal playback diagnostics inside the player while disabling only controls that require a working playback session;
- render invalid/non-playable player requests through the same recoverable player shell rather than a control-less error screen.

## 0.4.1 - 2026-08-18

- preserve structured server error responses in playback and catalogue diagnostics instead of coercing `error` objects to `[object Object]`;
- extract server-provided error messages and codes where available, with JSON rendering as a fallback for unfamiliar structured errors.

## 0.4.0 - 2026-08-18

- move playback ownership out of the `/play/:id` route into one persistent application-level player host; changing between full-player and bottom Now Playing presentations does not detach, reload or recreate the active media element/session;
- add an unobtrusive bottom Now Playing overlay while browsing, with live video thumbnail or music artwork, title/progress, play/pause, Previous/Next where a queue exists, expand and stop controls;
- make `/play/:id` a presentation route for the persistent host. Leaving the full player returns to the browsing route while playback continues, and reopening it expands the same live player;
- add a client-local persisted playback queue with current item/index and position checkpoint. Reloading can reconstruct a fresh playback session without persisting server capability/session URLs;
- initialise music queues from album track order and TV queues from season episode order, with Previous/Next controls and automatic advance on end;
- keep movie playback as the same queue model with a single item, preserving one Now Playing implementation across Movies, TV and Music.

## 0.3.21 - 2026-08-18

- move the Continue Watching overflow control onto the lower-right of the poster/artwork itself, keeping it visually subordinate to the media card;
- keep the existing removal behaviour, keyboard handling and TV focus model unchanged.

## 0.3.20 - 2026-08-18

- add a small lower-right overflow menu to Continue Watching cards, with a single `Remove` action;
- remove dismissed items immediately from the client-local Continue Watching store without changing or deleting catalogue media;
- support the menu with mouse, keyboard and TV focus navigation, including Escape-to-close behaviour.

## 0.3.19 - 2026-08-18

- add a fixed alphabetical index rail to Movies, TV Shows and Music, with unavailable letters visibly disabled and `#` for numeric/symbol titles;
- sort and index catalogue entries through the same title normalisation, ignoring leading `The`, `A` and `An` while leaving displayed titles unchanged;
- jump directly to the first visible catalogue item for the selected letter, including horizontal Artists/Albums rows on the existing Music screen;
- fold accented Latin initials into their base A-Z letter for indexing. Search behaviour is unchanged.

## 0.3.18 - 2026-08-16

- consume the revised `/api/v1/playback/sessions` contract directly: persisted preferences, resolved mode, original source/container/stream metadata and actual output stream metadata are now separate, with no legacy compatibility mapping;
- fix the player status display to use the server-resolved mode and per-stream transforms. Copy/copy sessions now report `DIRECT` or `REMUX`; mixed pipelines report video/audio copy/transcode independently; transcodes show original metadata followed by server-reported output codec, resolution/audio format and bitrate where known;
- make mode, quality, audio, subtitle and source controls mutate the live server session. Mode highlighting follows the persisted preference (so `Auto` remains visibly selected while the resolved mode may be Direct/Remux/Transcode), and the refreshed PATCH response replaces all session/control state at the current absolute playback position;
- stop inventing quality choices in the browser. The options panel renders only server-advertised mode/quality/track choices, while retaining `Original` as the reset for active quality constraints.

## 0.3.17 - 2026-08-16

- stop deriving playback decoder limits from the browser display resolution; Web now leaves `max_width`/`max_height` unset, while platforms with real decoder limits may still report them explicitly;
- probe browser codec support through both `HTMLMediaElement.canPlayType()` and `MediaSource.isTypeSupported()`, matching the direct-play and fMP4/HLS remux paths;
- detect AC-3/E-AC-3 using the ISO-BMFF `ac-3`/`ec-3` codec identifiers, retaining raw Dolby MIME names only as compatibility fallbacks;
- make detected codec/container capability logging explicit instead of relying on collapsed array output;
- keep HDR unadvertised on Web until the playback protocol defines a concrete HDR profile contract rather than inferring decode support from display capability.

## 0.3.16 - 2026-08-16

- make page containers fully fluid instead of imposing fixed desktop max-widths, including detail, album, settings, connection and sponsor layouts;
- let the Settings hero span the same full content width as the status cards below it;
- right-align the platform marker to the application edge while retaining centred primary navigation;
- simplify the Season back control to `Back`, matching the Series view;
- expand the player stream summary with selected video resolution plus audio language, codec, channel layout and sample rate, and place it beneath the title on the left of the player chrome;
- prefer the server's `server_version` field from `/api/v1/playback/status`, while retaining the existing compatibility fallbacks;
- include the fullscreen cursor auto-hide behaviour from the 0.3.15 quick patch in the release tree.

## 0.3.15 - 2026-08-16

- add a subtle centred Macha logo watermark behind every non-player screen;
- keep the player route completely free of the application watermark;
- make an interactive scrub position authoritative until the seek actually reaches the requested timeline position, preventing the progress bar from snapping back to stale playback state;
- pause the visible stream immediately when a seek is committed and suppress stale events from the old transformed stream while the server prepares the replacement generation;
- add a configurable 750 ms seek-spinner grace period so quick transformed seeks resume without flashing a loading indicator, while slower restarts show the spinner until playback starts;
- preserve pause/play intent across seeks: playing content resumes when the new stream starts, while a seek made from pause remains paused;
- retain opportunistic server-version detection without assuming a version when the current server does not report one.

## 0.3.14 - 2026-08-16

- redesign the settings page around the Macha logo and project name, with the client and connected-server versions shown prominently;
- query the playback/server and catalogue status endpoints independently and present a compact overall health summary, catalogue item/artwork state and sync generation;
- add a Donate / Sponsor action and local support stub page without introducing accounts, paid features or donation nags;
- derive the displayed client version directly from `package.json` so release metadata and the UI cannot drift;
- correct the stale splash timing regression test to match the one-second splash introduced in 0.3.12.

## 0.3.13 - 2026-08-16

- reuse the existing browser `<video>` element when a transformed seek switches to a new HLS generation, avoiding unnecessary playback-DOM destruction and reconstruction;
- add a web fullscreen transport control using the Fullscreen API, with explicit exit state and Escape handling that exits fullscreen without navigating away from playback;
- replace the previous wide logo artwork with the supplied square Macha logo in the application header, boot splash and browser favicon;
- make the video viewport explicitly fill the complete player page while retaining `object-fit: contain`, so source aspect ratio is never changed and any required letterboxing occurs on one axis only;
- use the server-returned aligned `seek_ms` as the transformed-generation timeline offset, so keyframe-aligned remux seeks report the position actually being played rather than the originally requested timestamp;
- add regression coverage that seek-only session PATCHes contain only `seek_ms`, preserving the server fast-seek path.

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
