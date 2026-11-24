import { describe, expect, it, jest } from '@jest/globals';

import type { Membership } from '@/domain/types';

import { checkLabSwitch, pickCurrentLab, sortByLabName } from '../currentLab';

function lab(id: string, name: string | null): Membership {
  return { account_id: id, user_id: 'u1', role: 'owner', initials: 'AB', accounts: name === null ? null : { name } };
}

describe('sortByLabName', () => {
  it('sorts by lab name ignoring case, without changing the input', () => {
    const input = [lab('a', 'zeta'), lab('b', 'Alpha'), lab('c', 'beta')];
    expect(sortByLabName(input).map((m) => m.account_id)).toEqual(['b', 'c', 'a']);
    expect(input.map((m) => m.account_id)).toEqual(['a', 'b', 'c']);
  });

  it('puts a lab with no name first rather than failing', () => {
    expect(sortByLabName([lab('a', 'Alpha'), lab('b', null)]).map((m) => m.account_id)).toEqual(['b', 'a']);
  });
});

describe('pickCurrentLab', () => {
  const labs = sortByLabName([lab('b', 'Beta'), lab('a', 'Alpha')]);

  it('keeps the saved lab while you are still a member', () => {
    expect(pickCurrentLab(labs, 'b')?.account_id).toBe('b');
  });

  it('falls back to the first lab by name when the saved lab is gone (e.g. you were removed)', () => {
    expect(pickCurrentLab(labs, 'removed')?.account_id).toBe('a');
  });

  it('uses the first lab by name when nothing was saved', () => {
    expect(pickCurrentLab(labs, null)?.account_id).toBe('a');
    expect(pickCurrentLab(labs, undefined)?.account_id).toBe('a');
  });

  it('is null when you belong to no lab', () => {
    expect(pickCurrentLab([], 'a')).toBeNull();
  });
});

describe('checkLabSwitch', () => {
  it('is a no-op for the current lab and does not count unsent changes', async () => {
    const count = jest.fn(async () => 5);
    await expect(checkLabSwitch('a', 'a', count)).resolves.toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  it('allows the switch when nothing is waiting to be sent', async () => {
    await expect(checkLabSwitch('b', 'a', async () => 0)).resolves.toBe(true);
  });

  it('allows the switch when no lab is current yet', async () => {
    await expect(checkLabSwitch('b', null, async () => 0)).resolves.toBe(true);
  });

  it('refuses while changes are unsent, naming how many', async () => {
    await expect(checkLabSwitch('b', 'a', async () => 3)).rejects.toThrow(
      "3 changes on this phone haven't been sent yet. Connect so they sync, then switch labs.",
    );
  });

  it('uses the singular for one unsent change', async () => {
    await expect(checkLabSwitch('b', 'a', async () => 1)).rejects.toThrow(/^1 change on this phone/);
  });
});
