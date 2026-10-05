import { useCallback, useEffect, useMemo, useState } from 'react';
import { identifyUnmatched, type CatalogueItem, type ManageApi, type PlaybackFactsApi, type PlaybackMediaFacts, type UnmatchedFile } from '@machafoundation/core';
import { AvailabilityMarker } from '../../components/Availability';
import { Modal } from '../../components/Modal';
import { fileName, formatBytes } from '../ingest/format';
import { playbackTimeText, viewerErrorText } from '../../text/viewerText';

/** Only these hold files; a series, season, artist or album holds its children instead. */
const PLAYABLE_KINDS = new Set(['movie', 'episode', 'track']);

function nameOf(path: string | undefined, fallback: string): string {
  return path ? fileName(path) : fallback;
}

/** For example "1920×1080 HEVC · AAC 6ch · MKV"; what the file does not state is left out. */
export function fileSummary(file: PlaybackMediaFacts): string {
  const video = file.profile.streams.find((stream) => stream.type === 'video');
  const audio = file.profile.streams.filter((stream) => stream.type === 'audio');
  const parts: string[] = [];
  if (video) parts.push([video.width && video.height ? `${video.width}×${video.height}` : '', video.codec.toUpperCase()].filter(Boolean).join(' '));
  if (audio[0]) parts.push([audio[0].codec.toUpperCase(), audio[0].channels ? `${audio[0].channels}ch` : '', audio.length > 1 ? `+${audio.length - 1}` : ''].filter(Boolean).join(' '));
  const container = file.profile.container ?? file.profile.format.split(',')[0];
  if (container) parts.push(container.toUpperCase());
  return parts.join(' · ');
}

/**
 * An item's files, each summarised, with a way to attach another version.
 * Attaching adds beside the existing files and never replaces them.
 */
export function ItemFiles({ item, facts, manage }: { item: CatalogueItem; facts: PlaybackFactsApi; manage?: ManageApi }) {
  const [files, setFiles] = useState<PlaybackMediaFacts[]>();
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setFiles(await facts.facts({ itemId: item.id }));
    } catch (cause) {
      setFiles([]);
      setError(viewerErrorText(cause));
    }
  }, [facts, item.id]);

  useEffect(() => { void load(); }, [load]);

  if (!PLAYABLE_KINDS.has(item.kind)) return null;

  return (
    <section className="metadata-editor-panel item-files" aria-labelledby="item-files-heading">
      <div className="item-files-heading">
        <h2 id="item-files-heading">Files</h2>
        {manage && <button className="secondary-button" type="button" onClick={() => setAdding(true)} data-tv-focusable="true">Add a file</button>}
      </div>
      {error && <p className="metadata-editor-error" role="alert">{error}</p>}
      {files === undefined ? <p className="metadata-editor-muted">Reading the files…</p>
        : files.length === 0 ? <p className="metadata-editor-muted">No file is attached to this item.</p>
          : (
            <ul className="item-files-list">
              {files.map((file, index) => (
                <li key={file.mediaId}>
                  <strong title={file.path}>
                    <AvailabilityMarker availability={file.availability?.availability} kind="file" className="availability-inline" />
                    {nameOf(file.path, `File ${index + 1}`)}
                  </strong>
                  <span>{[fileSummary(file), file.profile.durationMs ? playbackTimeText(file.profile.durationMs) : '', file.sizeBytes ? formatBytes(file.sizeBytes) : ''].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
      {files && files.length > 1 && <p className="metadata-editor-muted">Each viewer's player picks the version its device plays best.</p>}
      {manage && (
        <AddFileDialog
          open={adding}
          item={item}
          manage={manage}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); void load(); }}
        />
      )}
    </section>
  );
}

function AddFileDialog({ open, item, manage, onClose, onAdded }: {
  open: boolean;
  item: CatalogueItem;
  manage: ManageApi;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [unmatched, setUnmatched] = useState<UnmatchedFile[]>();
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setError(undefined);
    setUnmatched(undefined);
    manage.unmatched().then(setUnmatched, (cause: unknown) => { setUnmatched([]); setError(viewerErrorText(cause)); });
  }, [manage, open]);

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (unmatched ?? []).filter((file) => words.every((word) => file.path.toLowerCase().includes(word))).slice(0, 50);
  }, [filter, unmatched]);

  const add = async (file: UnmatchedFile) => {
    setBusy(file.id);
    setError(undefined);
    try {
      await identifyUnmatched(manage, file.id, { from: 'catalogue', catalogueItemId: item.id });
      onAdded();
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      open={open}
      title={`Add a file to ${item.title}`}
      onClose={busy ? () => undefined : onClose}
      actions={<button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={onClose} data-tv-focusable="true">Cancel</button>}
    >
      <p className="metadata-editor-muted">Choose an unmatched file. It is added beside this item's files as another version; nothing already attached is replaced.</p>
      <input
        className="item-files-filter"
        aria-label="Filter unmatched files"
        placeholder="Filter by name or folder"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        data-tv-focusable="true"
      />
      {error && <p className="metadata-editor-error" role="alert">{error}</p>}
      {unmatched === undefined ? <p className="metadata-editor-muted">Loading unmatched files…</p>
        : shown.length === 0 ? <p className="metadata-editor-muted">{unmatched.length === 0 ? 'There are no unmatched files.' : 'No unmatched file matches that filter.'}</p>
          : (
            <ul className="item-files-candidates">
              {shown.map((file) => (
                <li key={file.id}>
                  <span title={file.path}>{fileName(file.path)}<small>{file.path}</small></span>
                  <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void add(file)} data-tv-focusable="true">
                    {busy === file.id ? 'Adding…' : 'Add as a version'}
                  </button>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  );
}
