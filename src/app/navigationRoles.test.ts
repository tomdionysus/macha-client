import { describe, expect, it } from 'vitest';
import { hasRole, routes, sessionPermits, type UserRole } from '@machafoundation/core';
import { navItems } from '../App';

/** The nav decision as `App` makes it. `undefined` roles means not yet stated, which `sessionPermits` permits. */
function visibleSections(roles: UserRole[] | undefined): string[] {
  const permits = (role: UserRole) => sessionPermits(roles, role);
  const managementAvailable = true;
  const libraryManagementAvailable = managementAvailable && permits('manager');
  const usersAvailable = hasRole(roles, 'manage_users');
  return navItems
    .filter((item) => {
      if (item.to === routes.manage && !libraryManagementAvailable && !usersAvailable) return false;
      if (item.needs && !permits(item.needs)) return false;
      return true;
    })
    .map((item) => item.label);
}

describe('navigation role gating', () => {
  it('shows an ordinary viewer the catalogue and nothing administrative', () => {
    expect(visibleSections(['media_viewer'])).toEqual(['Home', 'Movies', 'TV Shows', 'Music', 'Search']);
  });

  it('hides every catalogue section from an account that may not read it', () => {
    // Home is a catalogue screen too.
    expect(visibleSections(['manage_users'])).toEqual(['Manage']);
  });

  it('gives a library manager Manage, but not Status — that is its own role now', () => {
    expect(visibleSections(['manager'])).toEqual(['Manage']);
  });

  it('gives Status to the role that exists for it, and nothing else', () => {
    expect(visibleSections(['view_status'])).toEqual(['Status']);
    expect(visibleSections(['media_viewer', 'view_status']))
      .toEqual(['Home', 'Movies', 'TV Shows', 'Music', 'Search', 'Status']);
  });

  it('shows Import only to an importer', () => {
    expect(visibleSections(['media_viewer'])).not.toContain('Import');
    expect(visibleSections(['media_viewer', 'importer'])).toContain('Import');
  });

  it('shows a session the server granted nothing no sections at all', () => {
    expect(visibleSections([])).toEqual([]);
  });

  it('hides nothing while the roles are unknown', () => {
    // Unknown is not "none": emptying the navigation on silence is worse than a section that later 401s.
    expect(visibleSections(undefined)).toEqual(
      ['Home', 'Movies', 'TV Shows', 'Music', 'Search', 'Import', 'Status', 'Manage'],
    );
  });
});
