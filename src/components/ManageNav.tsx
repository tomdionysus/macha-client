import { routes } from '@machafoundation/core';
import { SectionNav, type SectionNavItem } from './SectionNav';

const unmatched: SectionNavItem = { to: routes.manage, label: 'Unmatched', end: true };
const files: SectionNavItem = { to: routes.manageFiles, label: 'Files' };
const users: SectionNavItem = { to: routes.manageUsers, label: 'Users' };

/**
 * Only what the signed-in user can actually manage.
 *
 * Settings is deliberately absent: it is client-local configuration reaching
 * no server route, so grouping it under a privileged section meant hiding it
 * from the people most likely to need it — anyone who cannot reach a node has
 * no roles either, and the endpoint list is the one thing that would fix that.
 */
export function ManageNav({ managementAvailable, usersAvailable }: { managementAvailable: boolean; usersAvailable: boolean }) {
  return <SectionNav
    ariaLabel="Management navigation"
    items={[...(managementAvailable ? [unmatched, files] : []), ...(usersAvailable ? [users] : [])]}
  />;
}
