import { describe, expect, it } from 'vitest';
import { intentNote, removeAfterDefaultLabel, torrentNodeLabel } from './clusterTorrents';

const now = 1_000_000;

describe('an action on a cluster torrent, before its node applies it (server 0.64.0)', () => {
  it('says nothing once applied, or for a job from before intents', () => {
    expect(intentNote({ desired: 'paused', desired_applied: true }, now, 5_000)).toBeUndefined();
    expect(intentNote({}, now, 5_000)).toBeUndefined();
  });

  it('says what is under way while the node gets to it', () => {
    expect(intentNote({ desired: 'paused', desired_applied: false, desired_changed_unix_ms: now - 2_000 }, now, 5_000)).toBe('Pausing…');
    expect(intentNote({ desired: 'active', desired_applied: false, desired_changed_unix_ms: now - 2_000 }, now, 5_000)).toBe('Resuming…');
  });

  it('says why it waits when the server says it cannot apply it', () => {
    expect(intentNote({ desired: 'paused', desired_applied: false, desired_blocked_reason: 'owner_unreachable' }, now, 5_000)).toBe('Pause waiting: its node is out of reach');
    expect(intentNote({ desired: 'cancelled', desired_applied: false, desired_blocked_reason: 'no_capable_node' }, now, 5_000)).toBe('Cancel waiting: no node can take torrents');
  });

  it('calls it stuck after two refresh intervals with no reason given', () => {
    expect(intentNote({ desired: 'paused', desired_applied: false, desired_changed_unix_ms: now - 11_000 }, now, 5_000)).toBe('Pause waiting: not applied yet');
  });
});

describe('the add form\'s choices', () => {
  it('names the cluster default, or keeping it where there is none', () => {
    expect(removeAfterDefaultLabel(null)).toBe('Keep it (the default)');
    expect(removeAfterDefaultLabel(0)).toBe('Default: remove as soon as it completes');
    expect(removeAfterDefaultLabel(21_600_000)).toBe('Default: remove 6 hours after it completes');
  });

  it('names a node by its host, with its load or why it is not taking torrents', () => {
    expect(torrentNodeLabel({ node_id: 'n', host: 'gbni-1', accepting: true, not_accepting_reason: null, active_jobs: 1, max_active: 4 })).toBe('gbni-1 (1 of 4 running)');
    expect(torrentNodeLabel({ node_id: 'n', host: 'gbni-1', accepting: false, not_accepting_reason: 'staging_full', active_jobs: 4, max_active: 4 })).toBe('gbni-1 (staging full)');
  });
});
