import type { Membership } from '@/domain/types';

/** Your labs, sorted by name (case-insensitive). */
export function sortByLabName(list: Membership[]): Membership[] {
  return [...list].sort((a, b) =>
    (a.accounts?.name ?? '').localeCompare(b.accounts?.name ?? '', undefined, { sensitivity: 'base' }),
  );
}

/** The lab to work in: the saved one if you still belong to it, else the first by name. */
export function pickCurrentLab(sorted: Membership[], savedId: string | null | undefined): Membership | null {
  return sorted.find((m) => m.account_id === savedId) ?? sorted[0] ?? null;
}

/**
 * Decides whether a lab switch may go ahead. Returns false (nothing to do) for the
 * current lab without counting; throws while changes are still waiting to be sent,
 * because switching replaces the phone's local copy.
 */
export async function checkLabSwitch(
  targetId: string,
  currentId: string | null,
  countUnsent: () => Promise<number>,
): Promise<boolean> {
  if (targetId === currentId) return false;
  const unsent = await countUnsent();
  if (unsent > 0) {
    throw new Error(
      `${unsent} change${unsent === 1 ? '' : 's'} on this phone haven't been sent yet. Connect so they sync, then switch labs.`,
    );
  }
  return true;
}
