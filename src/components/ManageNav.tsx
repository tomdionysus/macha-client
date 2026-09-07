import { routes } from '@macha/core';
import { SectionNav, type SectionNavItem } from './SectionNav';

const managementItems: readonly SectionNavItem[] = [
  { to: routes.manage, label: 'Unmatched', end: true },
  { to: routes.manageFiles, label: 'Files' },
  { to: routes.settings, label: 'Settings' },
];

const settingsOnly: readonly SectionNavItem[] = [
  { to: routes.settings, label: 'Settings' },
];

export function ManageNav({ managementAvailable }: { managementAvailable: boolean }) {
  return <SectionNav ariaLabel="Management navigation" items={managementAvailable ? managementItems : settingsOnly} />;
}
