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

/**
 * The cluster gives an unauthenticated session no roles, so this signs in as
 * the test account the way any client does. Core stopped exporting a mint
 * helper in 0.10.0 — "one account model, no special anonymous" — and the
 * endpoint is two lines, so this asks the node directly rather than standing
 * up a `SessionManager` for one token.
 */
async function mint(node) {
  const username = process.env.MACHA_TEST_USER;
  const password = process.env.MACHA_TEST_PASSWORD;
  if (!username || !password) {
    throw new Error('Set MACHA_TEST_USER and MACHA_TEST_PASSWORD (they are in .env.local).');
  }
  const response = await fetch(`${node}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Nested, deliberately: a flat body is accepted and returns an anonymous
    // session holding no roles, which then 403s on the catalogue.
    body: JSON.stringify({ credentials: { username, password } }),
  });
  if (!response.ok) throw new Error(`session mint failed: ${response.status}`);
  return response.json();
}

const { token } = await mint(NODE);
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

// The node caps sessions at 4096 and a repeated run would fill it, so this
// run gives its own back rather than leaving it to expire.
await fetch(`${NODE}/api/v1/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  .catch((error) => console.error(`  (session revoke failed: ${error.message})`));

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
