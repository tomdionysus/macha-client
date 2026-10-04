import { routes } from '@machafoundation/core';
import { SectionNav } from './SectionNav';

const items = [
  { to: routes.ingestTorrents, label: 'Torrents' },
  { to: routes.ingestFiles, label: 'Files' },
] as const;

export function ImportNav() {
  return <SectionNav ariaLabel="Import navigation" items={items} />;
}
