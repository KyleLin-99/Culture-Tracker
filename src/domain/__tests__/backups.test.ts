import { describe, expect, it } from '@jest/globals';

import { addDays, backupsDue, DEFAULT_REFRESH_DAYS, dueText, refreshDays } from '../backups';

const b = (code: string, medium: 'slant' | 'lc' | 'agar' | 'tissue', made_on: string) => ({ id: code, code, medium, made_on });

describe('refresh ages', () => {
  it('fills in defaults and ignores unusable values', () => {
    expect(refreshDays(null)).toEqual(DEFAULT_REFRESH_DAYS);
    expect(refreshDays({ slant: 365, lc: 0, agar: 'x', other: 30.5 })).toEqual({ ...DEFAULT_REFRESH_DAYS, slant: 365 });
  });
});

describe('backups due', () => {
  const days = { slant: 180, lc: 120, agar: 60, other: 90 };
  const today = '2026-11-24';

  it('lists overdue and due-soon backups, most urgent first', () => {
    const due = backupsDue(
      [
        b('S-2(1)', 'slant', '2026-05-01'), // due 10-28: 27 days overdue
        b('S-2(2)', 'lc', '2026-08-01'), // due 11-29: in 5 days
        b('S-2(3)', 'agar', '2026-11-01'), // due 12-31: not yet
        b('S-2(4)', 'agar', '2026-09-25'), // due 11-24: today
        b('W(1)', 'tissue', '2026-08-01'), // other: due 10-30
      ],
      days,
      today,
    );
    expect(due.map((d) => [d.backup.code, d.dueOn, d.overdueDays, d.state])).toEqual([
      ['S-2(1)', '2026-10-28', 27, 'overdue'],
      ['W(1)', '2026-10-30', 25, 'overdue'],
      ['S-2(4)', '2026-11-24', 0, 'overdue'],
      ['S-2(2)', '2026-11-29', -5, 'soon'],
    ]);
    expect(due[0].ageDays).toBe(207);
  });

  it('looks 14 days ahead, no further', () => {
    expect(backupsDue([b('A', 'agar', '2026-10-09')], days, today)).toHaveLength(1); // due 12-08
    expect(backupsDue([b('A', 'agar', '2026-10-10')], days, today)).toHaveLength(0); // due 12-09
  });

  it('counts a leap day when working out the due date and age', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    // 180 days from 2027-12-01 crosses 2028-02-29: due 05-29, not 05-30.
    const [due] = backupsDue([b('L(1)', 'slant', '2027-12-01')], days, '2028-05-29');
    expect([due.dueOn, due.overdueDays, due.ageDays, due.state]).toEqual(['2028-05-29', 0, 180, 'overdue']);
  });

  it('uses the lab\'s own refresh ages, including for other media', () => {
    const saved = refreshDays({ other: 10 });
    expect(backupsDue([b('W(1)', 'tissue', '2026-11-10')], saved, today).map((d) => d.dueOn)).toEqual(['2026-11-20']);
    expect(backupsDue([b('W(1)', 'tissue', '2026-11-10')], DEFAULT_REFRESH_DAYS, today)).toEqual([]);
  });

  it('adds days across month and year ends, and words the due date', () => {
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect([dueText(0), dueText(1), dueText(3), dueText(-1), dueText(-5)]).toEqual([
      'due today', '1 day overdue', '3 days overdue', 'due in 1 day', 'due in 5 days',
    ]);
  });
});
