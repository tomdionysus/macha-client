import { describe, expect, it } from 'vitest';
import { StartRecorder, shouldReportStart, type StartSample } from './startRecorder';

const URL_ = 'http://10.44.1.50:7438/api/v1/playback/sessions/abc/stream/def/1/master.m3u8';

function clock() {
  let now = 1_000;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const nothing: StartSample = { readyState: 0, networkState: 2, hidden: false };

describe('what a start did before its first frame', () => {
  it('keeps the element events and only the samples where something changed', () => {
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    recorder.event('loadstart', nothing);
    for (let second = 0; second < 5; second += 1) {
      time.advance(1_000);
      recorder.sample(nothing);
    }
    time.advance(1_000);
    recorder.sample({ readyState: 1, networkState: 2, bufferedEndS: 4.2, hidden: true });
    time.advance(250);
    recorder.event('loadeddata', { readyState: 2, networkState: 2, bufferedEndS: 8, hidden: false });

    const record = recorder.finish('first-frame', []);
    expect(record?.timeline).toEqual([
      '+0 loadstart rs0/ns2',
      '+6000 sample rs1/ns2 buf4.2 hidden',
      '+6250 loadeddata rs2/ns2 buf8',
    ]);
    expect(record?.elapsedMs).toBe(6250);
  });

  it('says whether any request for this session left the page, and when', () => {
    // Resource Timing names a cross-origin request even without
    // Timing-Allow-Origin; only the detailed phases are withheld. Existence
    // and start/end are exactly the question: did the browser ask at all.
    const time = clock();
    const recorder = new StartRecorder('handover', URL_, time.now);
    time.advance(3_000);
    const record = recorder.finish('no-first-frame', [
      { name: 'http://10.44.1.50:7438/api/v1/playback/sessions/abc/stream/def/1/master.m3u8', startTime: 1_200, responseEnd: 1_260 },
      { name: 'http://10.44.1.50:7438/api/v1/playback/sessions/abc/stream/def/1/v/seg-0.m4s', startTime: 1_300, responseEnd: 3_900 },
      // Before arming: a previous generation's request, not this start's.
      { name: 'http://10.44.1.50:7438/api/v1/playback/sessions/abc/stream/def/1/v/seg-9.m4s', startTime: 900, responseEnd: 950 },
      // Another session on the same node.
      { name: 'http://10.44.1.50:7438/api/v1/playback/sessions/zzz/stream/q/1/master.m3u8', startTime: 1_500, responseEnd: 1_600 },
    ]);
    expect(record?.requests).toEqual({ count: 2, firstAtMs: 200, lastEndMs: 2_900 });
  });

  it('says it does not know rather than that nothing was sent', () => {
    // Measured live 2026-09-23: the page's Resource Timing buffer was full at
    // 250 entries eleven seconds after load, and three starts in a row were
    // recorded as "0 requests" while hls.js was plainly fetching. Zero is a
    // finding; unobservable is not, and the next diagnosis depends on which.
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    expect(recorder.finish('no-first-frame', undefined)?.requests).toBeUndefined();
  });

  it('shows a fragment that was asked for and never arrived', () => {
    // Resource Timing only lists a request once its response has ended, so a
    // fragment the node is still holding is invisible there. Measured live
    // 2026-09-23: a start whose last completed request was at 9.0 s, failed
    // at 16 s, with nothing to say whether anything was in flight between.
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    recorder.fragment('asked', 3);
    time.advance(400);
    recorder.fragment('got', 3);
    time.advance(100);
    recorder.fragment('asked', 4);
    time.advance(7_000);
    expect(recorder.finish('failed', [])?.timeline).toEqual([
      '+0 frag-asked sn3',
      '+400 frag-got sn3',
      '+500 frag-asked sn4',
    ]);
  });

  it('flattens an hls.js error to one line a person can read in a log', () => {
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    time.advance(1_500);
    recorder.hlsError({
      details: 'fragLoadError',
      fatal: false,
      response: { code: 404 },
      url: 'http://10.35.1.50:7438/api/v1/playback/sessions/dec/stream/a/1/v/seg-23.m4s',
    });
    expect(recorder.finish('failed', [])?.hls).toEqual(['+1500 fragLoadError 404 .../v/seg-23.m4s']);
  });

  it('reports once, however many things notice the end', () => {
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    expect(recorder.finish('failed', [])).toBeDefined();
    expect(recorder.finish('abandoned', [])).toBeUndefined();
    expect(recorder.finished).toBe(true);
  });

  it('stays bounded on a start that never ends', () => {
    const time = clock();
    const recorder = new StartRecorder('primary', URL_, time.now);
    for (let index = 0; index < 500; index += 1) {
      time.advance(100);
      recorder.sample({ readyState: index % 2, networkState: 2, hidden: false });
    }
    const record = recorder.finish('no-first-frame', []);
    expect(record!.timeline.length).toBeLessThanOrEqual(80);
    expect(record!.dropped).toBe(500 - record!.timeline.length);
  });
});

describe('which starts are worth a log line', () => {
  it('reports every start that did not reach a frame', () => {
    expect(shouldReportStart({ outcome: 'failed', elapsedMs: 10 })).toBe(true);
    expect(shouldReportStart({ outcome: 'no-first-frame', elapsedMs: 120_000 })).toBe(true);
    expect(shouldReportStart({ outcome: 'abandoned', elapsedMs: 5_000 })).toBe(true);
  });

  it('reports a slow first frame and stays quiet about a quick one', () => {
    expect(shouldReportStart({ outcome: 'first-frame', elapsedMs: 900 })).toBe(false);
    expect(shouldReportStart({ outcome: 'first-frame', elapsedMs: 3_000 })).toBe(true);
  });

  it('says nothing about a start abandoned before it could have been slow', () => {
    // A seek or a stop replaces a generation within a second all the time.
    expect(shouldReportStart({ outcome: 'abandoned', elapsedMs: 400 })).toBe(false);
  });
});
