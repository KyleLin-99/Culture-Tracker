// Culture code helpers for the app. The database builds every code; these
// mirror its rules for display, search and (in Milestone 2) offline creation.
//
//   origin    S, W, C or source initials (+ number once there are several): S, S2, TBG
//   transfer  numbers and letters alternate:  S-2 -> S-2A -> S-2A1
//   backup    parent + (n):                   S-2A1(2)
//   revived   new dash, starts with a number: S-2A1(2)-1
//   limit     20 characters

import type { ItemStatus, Medium } from './types';

export const MAX_CODE_LENGTH = 20;

/** Uppercases and strips spaces so " s-2a1 (2) " matches "S-2A1(2)". */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** 1 -> A, 26 -> Z, 27 -> AA */
export function positionLetters(position: number): string {
  let n = position;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** The code a new transfer would get, given its parent's code and kind. */
export function transferCode(parentCode: string, parentKind: 'origin' | 'transfer' | 'backup', position: number): string {
  if (parentKind !== 'transfer') return `${parentCode}-${position}`;
  return /[0-9]$/.test(parentCode) ? parentCode + positionLetters(position) : parentCode + String(position);
}

/** Characters left before a transfer from this code would hit the limit. */
export function roomLeft(code: string): number {
  return MAX_CODE_LENGTH - code.length;
}

export const ORIGIN_TYPES = [
  { prefix: 'S', label: 'Spore print', medium: 'spore_print' as Medium },
  { prefix: 'W', label: 'Wild clone', medium: 'tissue' as Medium },
  { prefix: 'C', label: 'Clone of my fruit', medium: 'tissue' as Medium },
] as const;

export const TRANSFER_MEDIA: { value: Medium; label: string }[] = [
  { value: 'agar', label: 'Agar' },
  { value: 'lc', label: 'Liquid culture' },
  { value: 'slant', label: 'Slant' },
  { value: 'other', label: 'Other' },
];

export const MEDIUM_LABEL: Record<Medium, string> = {
  spore_print: 'Spore print',
  spore_syringe: 'Spore syringe',
  swab: 'Swab',
  tissue: 'Tissue',
  culture: 'Culture',
  agar: 'Agar',
  lc: 'Liquid culture',
  slant: 'Slant',
  other: 'Other',
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  active: 'Active',
  contaminated: 'Contaminated',
  used: 'Used up',
  archived: 'Archived',
  discarded: 'Discarded',
};

/** YYYY-MM-DD in the phone's local time zone (not UTC). */
export function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 2026-11-16 -> 11/16/26, the way it goes on a label. */
export function labelDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
