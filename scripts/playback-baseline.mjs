/**
 * Buckets every catalogue title by the playback instruction the real chooser
 * picks from the real facts endpoint, for the given capabilities and policy.
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

/** Chrome on macOS as the client probes it. `matroska` is listed because `canPlayType` answers per codec for it. */
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
// The Samsung states these as host policy, not by narrowing its claimed capabilities.
const POLICIES = {
  none: {},
  samsung: { neverDirect: true, excludeContainers: ['webm'], preferSegmentContainer: 'mpegts' },
};
const overrides = POLICIES[arg('policy', 'none')] ?? {};

configureMachaHost({ origin: NODE });

/** Signs in as the test account: an unauthenticated session holds no roles. */
async function mint(node) {
  const username = process.env.MACHA_TEST_USER;
  const password = process.env.MACHA_TEST_PASSWORD;
  if (!username || !password) {
    throw new Error('Set MACHA_TEST_USER and MACHA_TEST_PASSWORD (they are in .env.local).');
  }
  const response = await fetch(`${node}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Must be nested: a flat body yields an anonymous, role-less session that 403s on the catalogue.
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

// Revoke the session: the node caps sessions at 4096 and repeated runs would fill it.
await fetch(`${NODE}/api/v1/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  .catch((error) => console.error(`  (session revoke failed: ${error.message})`));

console.log(`\n# Playback instruction baseline: ${probed} probed, ${failed} unavailable`);
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
