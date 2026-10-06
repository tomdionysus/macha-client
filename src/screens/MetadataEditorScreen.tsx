import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { CatalogueApi, CatalogueArtwork, CatalogueItem, CatalogueItemPatch, CatalogueKind, ManageApi, PlaybackFactsApi } from '@machafoundation/core';
import { ItemFiles } from './identify/ItemFiles';
import { NumberField, numberText, TextAreaField, TextField, wholeNumber } from './identify/fields';
import { ErrorMessage, Loading } from '../components/Status';
import { useAsync } from '../hooks/useAsync';
import { viewerErrorText } from '../text/viewerText';

interface Props {
  api: CatalogueApi;
  /** Reads what each of the item's files is. */
  facts: PlaybackFactsApi;
  /** Present when this account may attach files; adding a version needs it. */
  manage?: ManageApi;
  itemId: string;
  onBack: () => void;
  onSaved: () => void;
  onCleared: (item: CatalogueItem) => void;
}

/** The picture roles the server's cataloguer gives each kind, offered for upload even where none is attached yet. */
const KIND_ARTWORK_ROLES: Record<CatalogueKind, readonly string[]> = {
  movie: ['poster', 'backdrop'],
  show: ['poster', 'backdrop'],
  season: ['poster'],
  episode: ['still'],
  artist: [],
  album: ['cover'],
  track: ['cover'],
};

const INTERNAL_EXTERNAL_ID_PREFIX = 'macha_';
const METADATA_LOCK_KEY = 'macha_metadata_locked';


function isProviderExternalId(key: string): boolean {
  return !key.startsWith(INTERNAL_EXTERNAL_ID_PREFIX);
}

function providerLabel(key: string): string {
  switch (key) {
    case 'tmdb': return 'TMDB';
    case 'tmdb_collection': return 'TMDB collection';
    case 'musicbrainz': return 'MusicBrainz';
    case 'musicbrainz_release': return 'MusicBrainz release';
    case 'musicbrainz_release_group': return 'MusicBrainz release group';
    default: return key;
  }
}

function entityLabel(kind: CatalogueKind): string {
  switch (kind) {
    case 'show': return 'Series';
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function reorderArtwork(items: CatalogueArtwork[], selected: Record<string, string>): CatalogueArtwork[] {
  const roles: string[] = [];
  for (const item of items) if (!roles.includes(item.role)) roles.push(item.role);
  const output: CatalogueArtwork[] = [];
  for (const role of roles) {
    const group = items.filter((item) => item.role === role);
    const selectedId = selected[role];
    if (selectedId) {
      const chosen = group.find((item) => item.id === selectedId);
      if (chosen) output.push(chosen);
    }
    for (const item of group) {
      if (!output.some((candidate) => candidate.role === item.role && candidate.id === item.id)) output.push(item);
    }
  }
  return output;
}

/** The fields this editor changes; everything else on an item it leaves alone. */
const EDITED_FIELDS = ['title', 'sort_title', 'year', 'season_number', 'episode_number', 'disc_number', 'track_number', 'synopsis', 'aliases'] as const;

/**
 * Only the changed fields, for a partial save that cannot overwrite what something else wrote
 * meanwhile. Artwork is sent only when the chosen image changed its order.
 */
export function itemChanges(initial: CatalogueItem, edited: CatalogueItem): CatalogueItemPatch {
  const changes: Record<string, unknown> = {};
  for (const field of EDITED_FIELDS) {
    if (JSON.stringify(edited[field]) !== JSON.stringify(initial[field])) changes[field] = edited[field];
  }
  const order = (artwork: CatalogueArtwork[]) => artwork.map((art) => `${art.role}:${art.id}`).join('\n');
  if (order(edited.artwork) !== order(initial.artwork)) changes.artwork = edited.artwork;
  return changes as CatalogueItemPatch;
}

function ArtworkPreview({ api, artwork, selected, onSelect }: {
  api: CatalogueApi;
  artwork: CatalogueArtwork;
  selected: boolean;
  onSelect: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(undefined);
    setFailed(false);
    // A signed capability URL needs no client-side fetch/Blob lifecycle.
    if (artwork.url) return undefined;
    let cancelled = false;
    let objectUrl: string | undefined;
    void api.artwork(artwork.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, artwork.id, artwork.url]);

  const resolvedUrl = artwork.url ?? url;
  return (
    <button
      className={`metadata-artwork-option${selected ? ' selected' : ''}`}
      data-tv-focusable="true"
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={selected ? 'Selected image' : 'Use this image'}
    >
      <span className="metadata-artwork-image">
        {resolvedUrl && <img src={resolvedUrl} alt="" />}
        {!resolvedUrl && !failed && <span className="metadata-artwork-loading">…</span>}
        {failed && <span className="metadata-artwork-loading">Unavailable</span>}
      </span>
      <span className="metadata-artwork-id">{artwork.id.slice(0, 10)}</span>
    </button>
  );
}

function MetadataForm({ api, facts, manage, initial, onBack, onSaved, onCleared, onReload }: {
  /** Reads the item again, after something saved it outside this form. */
  onReload: () => void;
  facts: PlaybackFactsApi;
  manage?: ManageApi;
  api: CatalogueApi;
  initial: CatalogueItem;
  onBack: () => void;
  onSaved: () => void;
  onCleared: (item: CatalogueItem) => void;
}) {
  const [draft, setDraft] = useState<CatalogueItem>(() => structuredClone(initial));
  const [aliasesText, setAliasesText] = useState(() => initial.aliases.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedArtwork, setSelectedArtwork] = useState<Record<string, string>>(() => {
    const selected: Record<string, string> = {};
    for (const art of initial.artwork) if (!selected[art.role]) selected[art.role] = art.id;
    return selected;
  });

  const providerIds = useMemo(
    () => Object.entries(draft.external_ids).filter(([key]) => isProviderExternalId(key)),
    [draft.external_ids],
  );
  const artworkRoles = useMemo(() => {
    const roles: string[] = [];
    for (const art of draft.artwork) if (!roles.includes(art.role)) roles.push(art.role);
    for (const role of KIND_ARTWORK_ROLES[draft.kind] ?? []) if (!roles.includes(role)) roles.push(role);
    return roles;
  }, [draft.artwork, draft.kind]);
  const [uploading, setUploading] = useState<string>();
  // An upload saves and reloads the item, dropping unsaved edits, so it waits until the form is clean.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || aliasesText !== initial.aliases.join('\n');

  const upload = async (role: string, event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = '';
    if (!image) return;
    setUploading(role);
    setError(undefined);
    try {
      await api.putArtwork(initial.id, role, image.type || 'image/jpeg', image);
      onReload();
    } catch (cause) {
      setError(new Error(viewerErrorText(cause)));
      setUploading(undefined);
    }
  };

  const update = <K extends keyof CatalogueItem>(key: K, value: CatalogueItem[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const clearMetadata = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.clearMetadata(initial.id, initial.revision);
      onCleared(initial);
    } catch (caught) {
      setError(new Error(viewerErrorText(caught)));
      setConfirmClear(false);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      setError(new Error('Title is required.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const changes = itemChanges(initial, {
        ...draft,
        title,
        sort_title: draft.sort_title.trim() || title,
        aliases: aliasesText.split('\n').map((alias) => alias.trim()).filter(Boolean),
        artwork: reorderArtwork(draft.artwork, selectedArtwork),
      });
      // The server locks what it saves against the scanner; nothing changed is nothing to save.
      if (Object.keys(changes).length > 0) await api.patch(initial.id, changes, initial.revision);
      onSaved();
    } catch (caught) {
      setError(new Error(viewerErrorText(caught)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="metadata-editor">
      <div className="metadata-editor-toolbar">
        <button className="back-button" data-tv-focusable="true" onClick={onBack} type="button">← Back</button>
        <div className="metadata-editor-actions">
          <button className="secondary-button" data-tv-focusable="true" onClick={onBack} type="button">Cancel</button>
          <button className="primary-button" data-tv-focusable="true" disabled={saving} onClick={() => void save()} type="button">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <p className="eyebrow">Edit {entityLabel(draft.kind)}</p>
      <h1>{draft.title}</h1>
      <p className="metadata-editor-note">Manual changes are kept when the catalogue scanner runs again.</p>

      {error && <div className="metadata-editor-error" role="alert">{error.message}</div>}

      <div className="metadata-editor-grid">
        <section className="metadata-editor-panel">
          <h2>Metadata</h2>
          <TextField label="Title" value={draft.title} onChange={(value) => update('title', value)} />
          <TextField label="Sort title" value={draft.sort_title} onChange={(value) => update('sort_title', value)} />
          <NumberField label="Year" value={numberText(draft.year)} onChange={(value) => update('year', wholeNumber(value) ?? null)} />
          {(draft.kind === 'season' || draft.kind === 'episode') && (
            <NumberField label="Season number" value={numberText(draft.season_number)} onChange={(value) => update('season_number', wholeNumber(value) ?? null)} />
          )}
          {draft.kind === 'episode' && (
            <NumberField label="Episode number" value={numberText(draft.episode_number)} onChange={(value) => update('episode_number', wholeNumber(value) ?? null)} />
          )}
          {draft.kind === 'track' && (
            <>
              <NumberField label="Disc number" value={numberText(draft.disc_number)} onChange={(value) => update('disc_number', wholeNumber(value) ?? null)} />
              <NumberField label="Track number" value={numberText(draft.track_number)} onChange={(value) => update('track_number', wholeNumber(value) ?? null)} />
            </>
          )}
          <TextAreaField className="metadata-editor-wide-field" label="Synopsis" rows={8} value={draft.synopsis} onChange={(value) => update('synopsis', value)} />
          <TextAreaField className="metadata-editor-wide-field" label={<>Aliases <small>one per line</small></>} value={aliasesText} onChange={setAliasesText} />
        </section>

        <section className="metadata-editor-panel">
          <h2>Match</h2>
          {providerIds.length ? (
            <dl className="metadata-provider-ids">
              {providerIds.map(([key, value]) => (
                <div key={key}><dt>{providerLabel(key)}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          ) : (
            <p className="metadata-editor-muted">This item is not matched to an online metadata provider.</p>
          )}
          {draft.external_ids[METADATA_LOCK_KEY] === '1' && (
            <p className="metadata-lock-status">Manual metadata</p>
          )}
          <div className="metadata-destructive-actions">
            <button
              className="secondary-button metadata-clear-button"
              data-tv-focusable="true"
              disabled={saving}
              onClick={() => setConfirmClear(true)}
              type="button"
            >
              Clear metadata
            </button>
          </div>
          {confirmClear && (
            <div className="metadata-confirm" role="alertdialog" aria-live="polite">
              <strong>Clear all catalogue metadata?</strong>
              <p>
                This removes the catalogue match, descriptive metadata and artwork for this {entityLabel(draft.kind).toLowerCase()}.
                {' '}Everything beneath it is removed too, and its files are listed in Unmatched files to be identified by hand; nothing is matched again automatically.
              </p>
              <div>
                <button className="secondary-button" data-tv-focusable="true" disabled={saving} onClick={() => setConfirmClear(false)} type="button">Cancel</button>
                <button
                  className="primary-button metadata-confirm-danger"
                  data-tv-focusable="true"
                  disabled={saving}
                  onClick={() => void clearMetadata()}
                  type="button"
                >
                  {saving ? 'Clearing…' : 'Clear metadata'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <ItemFiles item={initial} facts={facts} manage={manage} onChanged={onReload} onTitleRemoved={() => onCleared(initial)} />

      <section className="metadata-editor-panel metadata-artwork-panel">
        <h2>Artwork</h2>
        {artworkRoles.length === 0 && <p className="metadata-editor-muted">No artwork is currently attached to this item.</p>}
        {artworkRoles.map((role) => {
          const items = draft.artwork.filter((art) => art.role === role);
          return (
            <div className="metadata-artwork-role" key={role}>
              <div className="metadata-artwork-role-heading">
                <h3>{role}</h3>
                <span>{items.length > 1 ? 'Choose the image used by the client' : items.length === 1 ? 'Current image' : 'None yet'}</span>
              </div>
              <div className="metadata-artwork-grid">
                {items.map((art) => (
                  <ArtworkPreview
                    key={`${art.role}:${art.id}`}
                    api={api}
                    artwork={art}
                    selected={(selectedArtwork[role] ?? items[0]?.id) === art.id}
                    onSelect={() => setSelectedArtwork((current) => ({ ...current, [role]: art.id }))}
                  />
                ))}
              </div>
              <label className="metadata-artwork-upload">
                <span>{uploading === role ? 'Uploading…' : `Upload a new ${role}`}</span>
                <input type="file" accept="image/*" disabled={dirty || Boolean(uploading)} onChange={(event) => void upload(role, event)} data-tv-focusable="true" />
              </label>
            </div>
          );
        })}
        {dirty && <p className="metadata-editor-muted">Save or cancel your changes before uploading: an upload saves at once.</p>}
      </section>
    </section>
  );
}

export function MetadataEditorScreen({ api, facts, manage, itemId, onBack, onSaved, onCleared }: Props) {
  const [version, setVersion] = useState(0);
  const item = useAsync(() => api.get(itemId), [api, itemId, version]);
  if (item.loading) return <Loading />;
  if (item.error) return <ErrorMessage error={item.error} />;
  if (!item.value) return null;
  return <MetadataForm key={`${item.value.id}:${item.value.revision}`} api={api} facts={facts} manage={manage} initial={item.value} onReload={() => setVersion((current) => current + 1)} onBack={onBack} onSaved={onSaved} onCleared={onCleared} />;
}
