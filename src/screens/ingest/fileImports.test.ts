import { describe, expect, it } from 'vitest';
import { MachaAcquisitionApiError } from '@machafoundation/core';
import { importQueuedText, ingestNodeLabel, ingestRefusalText } from './fileImports';

const refused = (status: number, code: string, detail?: string, reason?: string) => new MachaAcquisitionApiError('refused', status, code, detail, reason);

describe('a refused file import', () => {
  it('is the running node\'s own sentence for a bad path', () => {
    expect(ingestRefusalText(refused(400, 'bad_request', 'path does not exist'))).toBe('path does not exist');
  });

  it('says a node it could not reach is worth trying again', () => {
    expect(ingestRefusalText(refused(503, 'node_unreachable'))).toBe('That node cannot be reached right now. Try again shortly.');
  });

  it('says a node too old to place imports on needs upgrading', () => {
    expect(ingestRefusalText(refused(409, 'placement_failed', undefined, 'node_not_ingest_capable')))
      .toBe('That node cannot run imports until it is on server 0.91.1 or later.');
  });
});

describe('a node in the import selector', () => {
  const node = { nodeId: 'n', name: 'fi-1', version: '0.91.1', placeable: true, unavailableReason: null };
  it('is its name, with why it cannot take an import where it cannot', () => {
    expect(ingestNodeLabel(node)).toBe('fi-1');
    expect(ingestNodeLabel({ ...node, placeable: false, unavailableReason: 'before_placement' })).toBe('fi-1 (needs server 0.91.1)');
  });
});

describe('a queued import', () => {
  const names = new Map([['a', 'fi-1'], ['b', 'gbni-1']]);
  it('names the node it runs on', () => {
    expect(importQueuedText({ id: 'j', nodeId: 'b' }, '/mnt/x', names, 'b')).toBe('Import queued on gbni-1: /mnt/x');
  });
  it('says when the server ran it where it was taken, not where asked', () => {
    expect(importQueuedText({ id: 'j', nodeId: null, placementIgnored: true }, '/mnt/x', names, 'b'))
      .toBe('Import queued: /mnt/x. The server that took it cannot place imports yet, so it reads this path on its own disk, not on gbni-1.');
  });
});
