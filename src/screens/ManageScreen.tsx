import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { routes } from '@machafoundation/core';
import { BulkActions, ListHeading, Pager, runBulkOperation, SelectPageBox, SelectRowBox, useListSelection } from '../components/ListParts';
import { pageSlice } from '../lists/paging';
import { SortControl, SortHeader, useListSort } from '../components/ListSortControls';
import { sortRows, type ListSort, type SortKeyDef } from '../lists/listSort';
import { fileName, formatAge, formatBytes, formatTimestamp } from './ingest/format';
import { ConfirmModal, Modal } from '../components/Modal';
import { FileIcon, FolderIcon, OpenIcon, RefreshIcon, UpIcon } from '../components/ManageIcons';
import { AsyncIconButton } from '../components/AsyncIconButton';
import type {
  MachaDfsDirectory,
  MachaDfsEntry,
  ManageApi,
  UnmatchedFile,
} from '@machafoundation/core';
import { hintResultLabel, viewerErrorText } from '../text/viewerText';

export type ManageSection = 'unmatched' | 'files' | 'users';

interface Props {
  api: ManageApi;
  section: ManageSection;
  users: ReactNode;
}

function joinPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`;
  return `${parent.replace(/\/+$/, '')}/${name}`;
}

export function pathBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const names = path.split('/').filter(Boolean);
  return [
    { label: 'MachaDFS', path: '/' },
    ...names.map((label, index) => ({ label, path: `/${names.slice(0, index + 1).join('/')}` })),
  ];
}

type UnmatchedSortKey = 'updated' | 'name' | 'size' | 'result' | 'attempts';

const UNMATCHED_SORT_KEYS: readonly SortKeyDef<UnmatchedSortKey>[] = [
  { key: 'updated', label: 'Last attempt', direction: 'desc' },
  { key: 'name', label: 'Name', direction: 'asc' },
  { key: 'size', label: 'Size', direction: 'desc' },
  { key: 'result', label: 'Result', direction: 'asc' },
  { key: 'attempts', label: 'Attempts', direction: 'desc' },
];

const DEFAULT_UNMATCHED_SORT: ListSort<UnmatchedSortKey> = { key: 'updated', direction: 'desc' };

function unmatchedSortValue(item: UnmatchedFile, key: UnmatchedSortKey): number | string | undefined {
  switch (key) {
    case 'updated': return item.updated_unix_ms || undefined;
    case 'name': return fileName(item.path) || undefined;
    case 'size': return item.size > 0 ? item.size : undefined;
    case 'result': return item.result || undefined;
    case 'attempts': return item.attempts;
  }
}

/** The unmatched files in the order asked for, stable for the same files. */
export function sortUnmatched(items: readonly UnmatchedFile[], sort: ListSort<UnmatchedSortKey>): UnmatchedFile[] {
  return sortRows(items, sort, unmatchedSortValue, (item) => fileName(item.path), (item) => item.id);
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '/';
}

/**
 * The unmatched files as a list in the torrent list's style: one slim row per
 * file, sortable by column, the order kept in the address, and each file on
 * its own page. Selection and the bulk retry and delete stay, since this is
 * the page where many files are dealt with at once.
 */
function UnmatchedManager({ api }: { api: ManageApi }) {
  const navigate = useNavigate();
  const { sort, setSort, sortBy, page, setPage, search } = useListSort(UNMATCHED_SORT_KEYS, DEFAULT_UNMATCHED_SORT);
  const [items, setItems] = useState<UnmatchedFile[]>([]);
  const selection = useListSelection(items);
  const { checked } = selection;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.unmatched();
      setItems(next);
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const retryChecked = useCallback(async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    setError(undefined);
    const failed = await runBulkOperation(ids, (id) => api.retry(id));
    await reload();
    if (failed) setError(`${failed} of ${ids.length} files could not be queued for matching.`);
    setBusy(false);
  }, [api, checked, reload]);

  const deleteChecked = useCallback(async () => {
    const ids = deleteIds;
    if (ids.length === 0) return;
    setBusy(true);
    setError(undefined);
    const failed = await runBulkOperation(ids, (id) => api.deleteUnmatched(id));
    setDeleteIds([]);
    await reload();
    if (failed) setError(`${failed} of ${ids.length} files could not be deleted.`);
    setBusy(false);
  }, [api, deleteIds, reload]);

  const sorted = useMemo(() => sortUnmatched(items, sort), [items, sort]);
  const paged = pageSlice(sorted, page);
  const rows = paged.items;
  const now = Date.now();

  if (loading) return <p className="ingest-loading">Loading unmatched files…</p>;

  /** The whole row opens the file, except where a control inside it was the target. */
  const openRow = (event: MouseEvent<HTMLTableRowElement>, item: UnmatchedFile) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
    navigate(`${routes.manageUnmatchedFile(item.id)}${search}`);
  };

  return (
    <section className="unmatched-list" aria-labelledby="unmatched-heading">
      <ListHeading id="unmatched-heading" title="Unmatched files" count={items.length}>
        <div className="list-heading-controls">
          <SortControl keys={UNMATCHED_SORT_KEYS} sort={sort} onChange={setSort} />
          <AsyncIconButton label="Refresh unmatched files" busy={refreshing} disabled={busy} onClick={() => void refresh()} icon={<RefreshIcon />} />
        </div>
      </ListHeading>
      <p className="list-note">Files whose catalogue matching finished without a match.</p>
      {error && <p className="manage-error">{error}</p>}
      <BulkActions label="Selected unmatched file actions" selection={selection} disabled={busy}>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void retryChecked()} data-tv-focusable="true">Retry matching</button>
        <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => setDeleteIds([...checked])} data-tv-focusable="true">Delete files</button>
      </BulkActions>
      {items.length === 0 ? <p className="list-empty">No files need matching.</p> : (
        <div className="data-table-scroll">
          <table className="data-table unmatched-table" aria-labelledby="unmatched-heading">
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <SelectPageBox ids={rows.map((item) => item.id)} selection={selection} disabled={busy} />
                </th>
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={sortBy} className="col-name" />
                <th scope="col" className="col-folder col-optional">Folder</th>
                <SortHeader label="Size" sortKey="size" sort={sort} onSort={sortBy} className="col-size" />
                <SortHeader label="Result" sortKey="result" sort={sort} onSort={sortBy} className="col-status" />
                <th scope="col" className="col-provider col-optional">Provider</th>
                <SortHeader label="Attempts" sortKey="attempts" sort={sort} onSort={sortBy} className="col-attempts col-optional" />
                <SortHeader label="Last attempt" sortKey="updated" sort={sort} onSort={sortBy} className="col-added col-optional" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const name = fileName(item.path);
                return (
                  <tr key={item.id} className={checked.has(item.id) ? 'selected' : undefined} onClick={(event) => openRow(event, item)}>
                    <td className="col-check">
                      <SelectRowBox id={item.id} name={name} selection={selection} disabled={busy} />
                    </td>
                    <td className="col-name">
                      <Link to={`${routes.manageUnmatchedFile(item.id)}${search}`} data-tv-focusable="true" title={item.path}>{name}</Link>
                    </td>
                    <td className="col-folder col-optional" title={folderOf(item.path)}>{folderOf(item.path)}</td>
                    <td className="col-size">{formatBytes(item.size)}</td>
                    <td className="col-status">{hintResultLabel(item.result)}</td>
                    <td className="col-provider col-optional">{item.provider ?? 'catalogue'}</td>
                    <td className="col-attempts col-optional">{item.attempts}</td>
                    <td className="col-added col-optional" title={formatTimestamp(item.updated_unix_ms)}>{formatAge(item.updated_unix_ms, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager label="Unmatched files pages" {...paged} total={sorted.length} onPage={setPage} />
      <ConfirmModal
        open={deleteIds.length > 0}
        title={deleteIds.length === 1 ? 'Delete media file?' : `Delete ${deleteIds.length} media files?`}
        confirmLabel={deleteIds.length === 1 ? 'Delete file' : 'Delete files'}
        destructive
        busy={busy}
        onCancel={() => setDeleteIds([])}
        onConfirm={() => void deleteChecked()}
      >
        <p>This permanently removes {deleteIds.length === 1 ? 'the selected file' : 'the selected files'} from MachaDFS.</p>
      </ConfirmModal>
    </section>
  );
}

function FileManager({ api }: { api: ManageApi }) {
  const [directory, setDirectory] = useState<MachaDfsDirectory>();
  const [selected, setSelected] = useState<MachaDfsEntry>();
  const [destination, setDestination] = useState('');
  const [folderName, setFolderName] = useState('');
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(undefined);
    try {
      setDirectory(await api.browse(path));
      setSelected(undefined);
      setDestination('');
    } catch (cause) {
      setError(viewerErrorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void browse('/'); }, [browse]);

  const mutate = useCallback(async (action: () => Promise<void>, refreshPath: string): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await browse(refreshPath);
      return true;
    } catch (cause) {
      setError(viewerErrorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [browse]);

  if (loading && !directory) return <p>Loading MachaDFS…</p>;

  return (
    <section className="manage-panel">
      <div className="manage-panel-heading">
        <div><h2>MachaDFS</h2><p>Browse and modify the Macha Distributed File System namespace. Rename and move operations change namespace metadata; media extents remain in place.</p></div>
        <AsyncIconButton label="Refresh folder" busy={loading} disabled={busy || !directory} onClick={() => directory && void browse(directory.path)} icon={<RefreshIcon />} />
      </div>
      {error && <p className="manage-error">{error}</p>}
      {directory && (
        <>
          <div className="manage-pathbar">
            <nav className="manage-breadcrumbs" aria-label="MachaDFS path">
              {pathBreadcrumbs(directory.path).map((segment, index, segments) => <span key={segment.path}>
                {index > 0 && <span className="manage-path-separator" aria-hidden="true">/</span>}
                {index === segments.length - 1
                  ? <span aria-current="page">{segment.label}</span>
                  : <a href={`?path=${encodeURIComponent(segment.path)}`} onClick={(event) => { event.preventDefault(); void browse(segment.path); }}>{segment.label}</a>}
              </span>)}
            </nav>
            <div className="manage-path-actions">
              {directory.parent && <button className="secondary-button manage-icon-button" type="button" onClick={() => void browse(directory.parent!)} disabled={busy} aria-label="Up one folder" title="Up" data-tv-focusable="true"><UpIcon /></button>}
              <button className="secondary-button" type="button" onClick={() => setCreateFolderOpen(true)} disabled={busy} data-tv-focusable="true">Create folder</button>
            </div>
          </div>
          <div className="manage-fs-list" role="list">
            {directory.entries.map((entry) => (
              <div key={entry.path} className={`manage-fs-row${selected?.path === entry.path ? ' selected' : ''}`} role="listitem">
                <button className="manage-fs-select" type="button" onClick={() => {
                  setSelected(entry);
                  setDestination(entry.path);
                }} data-tv-focusable="true">
                  <span className="manage-fs-icon" aria-hidden="true">{entry.type === 'directory' ? <FolderIcon /> : <FileIcon />}</span>
                  <span><strong>{entry.name}</strong><small>{entry.type === 'directory' ? 'Folder' : `${formatBytes(entry.size)}${entry.catalogue_item_ids.length ? ' · catalogued' : ''}`}</small></span>
                </button>
                {entry.type === 'directory' && <button className="secondary-button manage-icon-button" type="button" onClick={() => void browse(entry.path)} aria-label={`Open ${entry.name}`} title="Open" data-tv-focusable="true"><OpenIcon /></button>}
              </div>
            ))}
            {directory.entries.length === 0 && <div className="manage-empty">This folder is empty.</div>}
          </div>
          {selected && (
            <div className="manage-fs-operation">
              <h3>{selected.name}</h3>
              <label>New path
                <input value={destination} onChange={(event) => setDestination(event.target.value)} disabled={busy} />
              </label>
              <div className="manage-actions">
                <button className="primary-button" type="button" disabled={busy || !destination.trim() || destination === selected.path} onClick={() => void mutate(() => api.rename(selected.path, destination.trim()), directory.path)} data-tv-focusable="true">Move / rename</button>
                <button className="secondary-button manage-danger" type="button" disabled={busy} onClick={() => setDeleteOpen(true)} data-tv-focusable="true">Delete</button>
              </div>
            </div>
          )}
          <Modal
            open={createFolderOpen}
            title="Create folder"
            onClose={busy ? () => undefined : () => { setCreateFolderOpen(false); setFolderName(''); }}
            actions={<>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => { setCreateFolderOpen(false); setFolderName(''); }} data-tv-focusable="true">Cancel</button>
              <button className="primary-button" type="button" disabled={busy || !folderName.trim()} onClick={() => {
                const path = joinPath(directory.path, folderName.trim());
                void mutate(() => api.mkdir(path), directory.path).then((created) => {
                  if (created) { setCreateFolderOpen(false); setFolderName(''); }
                });
              }} data-tv-focusable="true">{busy ? 'Creating…' : 'Create'}</button>
            </>}
          >
            <label className="modal-field">Folder name
              <input value={folderName} onChange={(event) => setFolderName(event.target.value)} disabled={busy} onKeyDown={(event) => {
                if (event.key === 'Enter' && folderName.trim() && !busy) {
                  const path = joinPath(directory.path, folderName.trim());
                  void mutate(() => api.mkdir(path), directory.path).then((created) => {
                    if (created) { setCreateFolderOpen(false); setFolderName(''); }
                  });
                }
              }} />
            </label>
          </Modal>
          <ConfirmModal
            open={deleteOpen && Boolean(selected)}
            title={`Delete ${selected?.type === 'directory' ? 'folder' : 'file'}?`}
            confirmLabel={selected?.type === 'directory' ? 'Delete folder' : 'Delete file'}
            destructive
            busy={busy}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={() => {
              if (!selected) return;
              void mutate(() => api.deletePath(selected.path), directory.path).then((deleted) => {
                if (deleted) setDeleteOpen(false);
              });
            }}
          >
            <p><code>{selected?.path}</code> will be removed from MachaDFS. A non-empty folder may be rejected by the server.</p>
          </ConfirmModal>
        </>
      )}
    </section>
  );
}

export function ManageScreen({ api, section, users }: Props) {
  return (
    <div className={`manage-screen manage-screen-${section}`}>
      <h1>Manage</h1>
      {section === 'users'
        ? users
        : section === 'files'
          ? <FileManager api={api} />
          : <UnmatchedManager api={api} />}
    </div>
  );
}
