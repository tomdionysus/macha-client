import { routes } from '@machafoundation/core';
import { SectionNav } from './SectionNav';

/** Torrents are one kind of import, not the whole of it: each kind has its own page. */
const items = [
  { to: routes.ingestTorrents, label: 'Torrents' },
  { to: routes.ingestFiles, label: 'Files' },
] as const;

export function ImportNav() {
  return <SectionNav ariaLabel="Import navigation" items={items} />;
}
