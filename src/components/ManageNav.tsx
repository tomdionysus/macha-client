import { routes } from '@machafoundation/core';
import { SectionNav, type SectionNavItem } from './SectionNav';

const unmatched: SectionNavItem = { to: routes.manageUnmatched, label: 'Unmatched' };
const files: SectionNavItem = { to: routes.manageFiles, label: 'Files' };
const users: SectionNavItem = { to: routes.manageUsers, label: 'Users' };

/**
 * Only what the signed-in user can manage. Settings is absent: it is client-local, and a
 * user who cannot reach a node has no roles but needs the endpoint list.
 */
export function ManageNav({ managementAvailable, usersAvailable }: { managementAvailable: boolean; usersAvailable: boolean }) {
  return <SectionNav
    ariaLabel="Management navigation"
    items={[...(managementAvailable ? [unmatched, files] : []), ...(usersAvailable ? [users] : [])]}
  />;
}
