// Backup viability: stored backups (slants, LC, agar) lose viability with age, so
// each needs refreshing after a number of days set per medium in lab settings.
// Pure functions, so web and phones (reading their local copy) agree.

import { daysBetween } from './growth';
import type { Medium } from './types';

export type BackupMedium = 'slant' | 'lc' | 'agar' | 'other';
export const BACKUP_MEDIA: BackupMedium[] = ['slant', 'lc', 'agar', 'other'];

/**
 * Starting points, changeable in Lab settings: slants keep longest in the fridge,
 * LC a few months, agar plates the shortest.
 */
export const DEFAULT_REFRESH_DAYS: Record<BackupMedium, number> = { slant: 180, lc: 120, agar: 60, other: 180 };

/** How far ahead "due soon" looks. */
export const DUE_SOON_DAYS = 14;

/** The lab's refresh ages with defaults filled in (and anything unusable ignored). */
export function refreshDays(saved: Partial<Record<string, unknown>> | null | undefined): Record<BackupMedium, number> {
  const out = { ...DEFAULT_REFRESH_DAYS };
  for (const m of BACKUP_MEDIA) {
    const v = saved?.[m];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1) out[m] = v;
  }
  return out;
}

const mediumKey = (m: Medium): BackupMedium => (m === 'slant' || m === 'lc' || m === 'agar' ? m : 'other');

/** YYYY-MM-DD plus n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type BackupLike = { id: string; code: string; medium: Medium; made_on: string };

export type DueBackup<T extends BackupLike> = {
  backup: T;
  ageDays: number;
  dueOn: string;
  /** Days past due (negative = due in that many days). */
  overdueDays: number;
  state: 'overdue' | 'soon';
};

/** Active backups that are past their refresh age or within DUE_SOON_DAYS of it, most urgent first. */
export function backupsDue<T extends BackupLike>(
  backups: T[],
  days: Record<BackupMedium, number>,
  today: string,
): DueBackup<T>[] {
  return backups
    .map((b) => {
      const dueOn = addDays(b.made_on, days[mediumKey(b.medium)]);
      const overdueDays = daysBetween(dueOn, today);
      return { backup: b, ageDays: daysBetween(b.made_on, today), dueOn, overdueDays, state: overdueDays >= 0 ? 'overdue' : 'soon' } as DueBackup<T>;
    })
    .filter((d) => d.overdueDays >= -DUE_SOON_DAYS)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.backup.code.localeCompare(b.backup.code));
}

/** "due today", "3 days overdue", "due in 5 days" */
export function dueText(overdueDays: number): string {
  if (overdueDays === 0) return 'due today';
  const n = Math.abs(overdueDays);
  const d = `${n} day${n === 1 ? '' : 's'}`;
  return overdueDays > 0 ? `${d} overdue` : `due in ${d}`;
}
