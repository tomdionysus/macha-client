/**
 * Which titles in the library exercise which playback instruction.
 *
 * Runs the real chooser (`choosePlaybackInstruction`) over the real facts
 * endpoint for every catalogue item, so the buckets are what this client would
 * genuinely ask for rather than what a reimplementation guesses. Capabilities
 * are an input, so the same library can be bucketed for Chrome, for the
 * Samsung's narrower profile, or for anything else.
 *
 *   node playback-baseline.mjs [--node http://10.44.1.50:7438] [--caps caps.json]
 *                              [--limit 400] [--policy samsung]
 */
import {
  choosePlaybackInstruction,
  configureMachaHost,
  fixedBearerToken,
  MachaCatalogueApi,
  MachaPlaybackFactsApi,
  mintAnonymousSession,
} from '@machafoundation/core';
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const NODE = arg('node', 'http://10.44.1.50:7438');
const LIMIT = Number(arg('limit', '400'));

/**
 * Chrome 151 on macOS, probed live from the running client. `matroska` joined
 * the list on 2026-09-13, when `canPlayType` was measured to discriminate on
 * it properly: `video/x-matroska; codecs="avc1.42E01E"` answers `probably`
 * and the same container with a nonsense codec answers `""`.
 */
const CHROME = {
  platform: 'web',
  videoCodecs: ['h264', 'hevc', 'vp9', 'av1'],
  audioCodecs: ['aac', 'opus', 'vorbis', 'mp3', 'flac'],
  hlsVideoCodecs: ['h264', 'hevc', 'vp9', 'av1'],
  hlsAudioCodecs: ['aac', 'opus', 'mp3'],
  containers: ['mp4', 'webm', 'matroska', 'mp3', 'flac', 'ogg'],
  hlsFmp4: true, hlsTs: true, dash: false,
  videoBitDepth: 12, hdr: [], dolbyVision: [],
};

const capsPath = arg('caps');
const capabilities = capsPath ? JSON.parse(readFileSync(capsPath, 'utf8')) : CHROME;
// The Samsung states these as host policy rather than by narrowing what it
// claims to decode; bucketing for that target has to apply them too.
const POLICIES = {
  none: {},
  samsung: { neverDirect: true, excludeContainers: ['webm'], preferSegmentContainer: 'mpegts' },
};
const overrides = POLICIES[arg('policy', 'none')] ?? {};

configureMachaHost({ origin: NODE });

const { token } = await mintAnonymousSession(NODE);
const auth = fixedBearerToken(token);
const catalogue = new MachaCatalogueApi(NODE, auth);
const facts = new MachaPlaybackFactsApi(NODE, auth);

const items = [];
for (const kind of ['movie', 'episode', 'track']) {
  try {
    const page = await catalogue.list(kind);
    items.push(...page.slice(0, LIMIT));
  } catch (error) {
    console.error(`  (${kind} listing failed: ${error.message})`);
  }
}
console.error(`Probing ${items.length} items against ${NODE}...`);

const buckets = new Map();
let probed = 0, failed = 0;
for (const item of items) {
  let media;
  try {
    media = (await facts.facts({ itemId: item.id }))[0];
  } catch { failed += 1; continue; }
  if (!media) { failed += 1; continue; }
  probed += 1;
  const instruction = choosePlaybackInstruction(media.profile, capabilities, {
    operations: media.operations,
    overrides,
  });
  const key = `${instruction.mode}  video:${instruction.video}  audio:${instruction.audio}`;
  const video = media.profile.streams.find((s) => s.type === 'video');
  const audio = media.profile.streams.find((s) => s.type === 'audio' && s.default)
    ?? media.profile.streams.find((s) => s.type === 'audio');
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push({
    id: item.id,
    title: item.title,
    container: media.profile.container ?? media.profile.format,
    v: video && `${video.codec}${video.bitDepth ? `/${video.bitDepth}bit` : ''}`,
    a: audio && `${audio.codec}${audio.channels ? `/${audio.channels}ch` : ''}`,
    reasons: instruction.reasons.join(','),
    segment: instruction.container ?? '-',
  });
}

console.log(`\n# Playback instruction baseline — ${probed} probed, ${failed} unavailable`);
console.log(`# node ${NODE}  policy ${arg('policy', 'none')}\n`);
for (const [key, rows] of [...buckets.entries()].sort()) {
  console.log(`## ${key}   (${rows.length})`);
  console.log(`   reasons: ${rows[0].reasons || 'none'}   segment: ${rows[0].segment}`);
  for (const r of rows.slice(0, 4)) {
    console.log(`   - ${r.title}`);
    console.log(`     ${r.id}   ${r.container}  v=${r.v}  a=${r.a}`);
  }
  if (rows.length > 4) console.log(`   ... and ${rows.length - 4} more`);
  console.log('');
}
