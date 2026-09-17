# A scope title plays small in a black window, and it is not the fit

2026-09-16. A 2.3:1 title played in a window wider than 16:9 shows black on all
four sides. Two sessions have now reasoned their way to a client-side fix for
it, and both were wrong. This is what the black actually is.

## Settled

The source has **burnt-in letterboxing, top and bottom**: a ~2.3:1 picture
encoded into a 1920×1080 raster. Confirmed by Tom against the file itself.

The bars left and right are the client's `object-fit: contain`, correctly
fitting a 16:9 frame into a window wider than 16:9.

So the four-sided black is two unrelated things stacked: bars in the media, and
a correct fit. Neither is a client defect.

**Fullscreen looks right for a reason that is not a fix**, and reading it as
one is what sent two sessions after a client bug. On a 16:9 monitor the
viewport aspect equals the frame aspect, so `contain` fills it exactly and
there is no spare axis to put bars on — the side bars go because the mismatch
went to zero. The burnt-in bands are still there in fullscreen, because they
are picture. At any window that is not 16:9, side bars on that title are
unavoidable and correct.

## The client's fit is correct and was never the fault

`.native-video` is `object-fit: contain` — fill one axis, keep the aspect,
spend the spare axis on bars. That is the whole requirement, in a variable
viewport, and CSS already does it. Anything that swaps it for `cover` is
cropping real picture.

## How to tell CSS letterboxing from black in the frame, in one step

Paint the media element's own background a colour nothing else uses:

```js
const v = document.querySelector('video');
v.style.background = 'magenta';
v.style.objectFit = 'contain';
```

The element's box is the whole host, so wherever the picture does not cover it,
the background shows through: `contain`'s letterbox region turns magenta and
anything still black is inside the picture. No canvas, no pixel reads, one
line. Live on 2026-09-16, window 1920×813, frame 1920×1080, on a `VIDEO COPY`
session with the server re-encoding nothing:

- Left and right: **magenta** — CSS, behaving as asked.
- Top and bottom: **black**, ~11% of the height each, leaving about 2.3:1 —
  the media.

Worth keeping. It is the cheapest way to answer "is this us?" for any fit
question, and it would have ended this one in the first five minutes.

## What the client should do about it: nothing

There is no fact available to the client that distinguishes a title with
burnt-in bars from one that fills its frame. `videoWidth`/`videoHeight` report
the raster in both cases, and the play session reports the same raster. Any
client-side rule is therefore an inference from aspect ratios, and it is wrong
for every title that genuinely fills its frame — it crops their picture to
remove bars that are not there.

**Two such rules were written and reverted on 2026-09-16**: an aspect-tolerance
("fill when the frame and the viewport are within ~25%") and a "16:9 is a
delivery container, so fill it". Do not write a third.

## It is the server's, and this is the ask

Detected once at ingest, reported on the play session, cropped by the client.

**Not cropped server-side.** Cropping in the pipeline forces a transcode on a
title that would otherwise copy or direct-play, costs quality and CPU per
viewer, and cannot help a direct session at all. The server states the fact;
applying it is a transform on the media element and costs nothing.

**The fact.** A title's real picture area within its coded raster, from
`ffmpeg cropdetect` over a sample of frames across the runtime (not the opening
minute — fades and dark scenes under-report, so take the union). Stored against
the media, because it is a property of the media and never of a session.

**The shape.** Reported wherever the frame is reported — on the source video
stream, since that is what it describes — and absent when unknown, never
defaulted to the full raster:

```
"aperture": { "x": 0, "y": 124, "width": 1920, "height": 832 }
```

Absent must mean "this node did not say", exactly as `output.container` does
today. A client that reads an absent aperture as the full frame would be
asserting a fact nobody stated.

**Then the client's share is small**: fit to the aperture rather than the coded
frame — scale the element so the aperture fills the host and let
`.player-host`'s existing `overflow: hidden` clip the rest. Fit stays `contain`
throughout; nothing guesses, and a title with no aperture behaves exactly as it
does today.

**Worth knowing before it is built:** this buys nothing on a 16:9 screen, where
a 2.3:1 picture fitted into 16:9 is the same size whether the bars are in the
file or added by `contain`. The gain is where the viewport is wider than the
frame — at 1920×813 the picture goes from 1445×626 to 1876×813, about 70% more
area, and on an ultrawide it very nearly fills the screen. Windowed and
ultrawide playback, not the television.

## Verification

- [ ] Server: `cropdetect` at ingest, aperture on the play session.
- [ ] Client: fit to the aperture when one is stated; unchanged when it is not.
- [ ] Live, in a window wider than 16:9: the picture grows to fill the width
      and the burnt-in bands leave the screen. Confirm with the magenta test
      that what remains, if anything, is CSS and not picture.
