import { useEffect, useMemo, useState } from 'react';
import type { CatalogueApi, CatalogueArtwork, CatalogueItem, CatalogueKind } from '@machafoundation/core';
import { ErrorMessage, Loading } from '../components/Status';
import { useAsync } from '../hooks/useAsync';

interface Props {
  api: CatalogueApi;
  itemId: string;
  onBack: () => void;
  onSaved: () => void;
  onCleared: (item: CatalogueItem) => void;
}

const INTERNAL_EXTERNAL_ID_PREFIX = 'macha_';
const METADATA_LOCK_KEY = 'macha_metadata_locked';

function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function MetadataForm({ api, initial, onBack, onSaved, onCleared }: {
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
    return roles;
  }, [draft.artwork]);

  const update = <K extends keyof CatalogueItem>(key: K, value: CatalogueItem[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const lockExternalIds = (externalIds: Record<string, string>) => ({
    ...externalIds,
    [METADATA_LOCK_KEY]: '1',
  });

  const clearMetadata = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.clearMetadata(initial.id, initial.revision);
      onCleared(initial);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
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
      const payload: CatalogueItem = {
        ...draft,
        title,
        sort_title: draft.sort_title.trim() || title,
        aliases: aliasesText.split('\n').map((alias) => alias.trim()).filter(Boolean),
        artwork: reorderArtwork(draft.artwork, selectedArtwork),
        external_ids: lockExternalIds(draft.external_ids),
      };
      await api.update(payload, initial.revision);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
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
          <label>
            <span>Title</span>
            <input value={draft.title} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label>
            <span>Sort title</span>
            <input value={draft.sort_title} onChange={(event) => update('sort_title', event.target.value)} />
          </label>
          <label>
            <span>Year</span>
            <input inputMode="numeric" value={draft.year ?? ''} onChange={(event) => update('year', optionalInt(event.target.value))} />
          </label>
          {(draft.kind === 'season' || draft.kind === 'episode') && (
            <label>
              <span>Season number</span>
              <input inputMode="numeric" value={draft.season_number ?? ''} onChange={(event) => update('season_number', optionalInt(event.target.value))} />
            </label>
          )}
          {draft.kind === 'episode' && (
            <label>
              <span>Episode number</span>
              <input inputMode="numeric" value={draft.episode_number ?? ''} onChange={(event) => update('episode_number', optionalInt(event.target.value))} />
            </label>
          )}
          {draft.kind === 'track' && (
            <>
              <label>
                <span>Disc number</span>
                <input inputMode="numeric" value={draft.disc_number ?? ''} onChange={(event) => update('disc_number', optionalInt(event.target.value))} />
              </label>
              <label>
                <span>Track number</span>
                <input inputMode="numeric" value={draft.track_number ?? ''} onChange={(event) => update('track_number', optionalInt(event.target.value))} />
              </label>
            </>
          )}
          <label className="metadata-editor-wide-field">
            <span>Synopsis</span>
            <textarea rows={8} value={draft.synopsis} onChange={(event) => update('synopsis', event.target.value)} />
          </label>
          <label className="metadata-editor-wide-field">
            <span>Aliases <small>one per line</small></span>
            <textarea rows={4} value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} />
          </label>
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
                {' '}Dependent catalogue entries are also removed where necessary so the underlying media becomes unbound and can be probed and matched again by the cataloguer.
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

      <section className="metadata-editor-panel metadata-artwork-panel">
        <h2>Artwork</h2>
        {artworkRoles.length === 0 && <p className="metadata-editor-muted">No artwork is currently attached to this item.</p>}
        {artworkRoles.map((role) => {
          const items = draft.artwork.filter((art) => art.role === role);
          return (
            <div className="metadata-artwork-role" key={role}>
              <div className="metadata-artwork-role-heading">
                <h3>{role}</h3>
                <span>{items.length > 1 ? 'Choose the image used by the client' : 'Current image'}</span>
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
            </div>
          );
        })}
      </section>
    </section>
  );
}

export function MetadataEditorScreen({ api, itemId, onBack, onSaved, onCleared }: Props) {
  const item = useAsync(() => api.get(itemId), [api, itemId]);
  if (item.loading) return <Loading />;
  if (item.error) return <ErrorMessage error={item.error} />;
  if (!item.value) return null;
  return <MetadataForm key={`${item.value.id}:${item.value.revision}`} api={api} initial={item.value} onBack={onBack} onSaved={onSaved} onCleared={onCleared} />;
}
