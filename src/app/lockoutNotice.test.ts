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
  it('leaves a role-less session to the login screen\'s own line', () => {
    expect(lockoutNotice('no-roles')).toBeUndefined();
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
