import { routes } from '../routing';
import { SectionNav } from './SectionNav';

const items = [
  { to: routes.status, label: 'Overview', end: true },
  { to: routes.statusClient, label: 'Client' },
  { to: routes.statusConnectivity, label: 'Connectivity' },
  { to: routes.statusNodes, label: 'Nodes' },
] as const;

export function StatusNav() {
  return <SectionNav ariaLabel="Status navigation" items={items} />;
}
