import { describe, expect, it } from 'vitest';
import { lockoutNotice, lockoutReason } from './lockoutNotice';

describe('lockoutReason', () => {
  it('names a session that exists and may do nothing', () => {
    expect(lockoutReason([], false)).toBe('no-roles');
  });

  it('says nothing when the cluster never stated any roles, because unknown is not none', () => {
    expect(lockoutReason(undefined, false)).toBeUndefined();
  });

  it('says nothing for a session that holds roles', () => {
    expect(lockoutReason(['media_viewer'], false)).toBeUndefined();
  });

  it('names a refusal, which is no session rather than an empty one', () => {
    expect(lockoutReason(undefined, true)).toBe('refused');
  });

  it('prefers the role-less case when both are true, because a session that exists is the more specific fact', () => {
    expect(lockoutReason([], true)).toBe('no-roles');
  });
});

describe('lockoutNotice', () => {
  it('sends a role-less viewer to the remedy that answers two of the three causes', () => {
    const notice = lockoutNotice('no-roles')!;
    // Log in first: a cluster carrying no anonymous viewer and a session
    // degraded by a credential-less re-mint are both fixed by signing in.
    expect(notice).toMatch(/log in/i);
    expect(notice).toMatch(/administrator/i);
    expect(notice.search(/log in/i)).toBeLessThan(notice.search(/administrator/i));
    expect(notice).toContain('media_viewer');
  });

  it('says what the state is as well as what to do about it', () => {
    expect(lockoutNotice('no-roles')).toMatch(/no permissions/i);
  });

  it('tells a refused viewer to sign in, which is the thing that would work', () => {
    expect(lockoutNotice('refused')).toMatch(/sign in/i);
  });

  it('never claims a role problem on a refusal', () => {
    expect(lockoutNotice('refused')).not.toMatch(/role/i);
  });

  it('has nothing to say when nothing is wrong', () => {
    expect(lockoutNotice(undefined)).toBeUndefined();
  });
});
