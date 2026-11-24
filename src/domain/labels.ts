// Culture labels: what the QR code holds, how a scan is read back, and the
// printable label document. Label text follows the lab's format:
// strain · date · initials · culture code.

import { labelDate, normalizeCode } from './cultureCode';
import { qrSvg } from './qr';

/**
 * The QR holds the culture's id as an app link, not its code: the id never
 * changes (even when a plate is relabeled after an offline conflict) and is
 * unique across strains. Phone cameras open it in the app.
 */
export const qrPayload = (itemId: string) => `culturetracker://items/${itemId}`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type ScanResult = { kind: 'item'; id: string } | { kind: 'code'; code: string } | null;

/** Reads a scanned (or typed) label: our QR link, any link to /items/<id>, a bare id, or a culture code. */
export function parseScan(raw: string): ScanResult {
  const text = raw.trim();
  if (!text) return null;
  const link = text.match(new RegExp(`(?:^culturetracker://|/)items/(${UUID.source})(?:[/?#]|$)`, 'i'));
  if (link) return { kind: 'item', id: link[1].toLowerCase() };
  if (new RegExp(`^${UUID.source}$`, 'i').test(text)) return { kind: 'item', id: text.toLowerCase() };
  if (/^[a-z]+:\/\//i.test(text)) return null; // someone else's QR code
  const code = normalizeCode(text);
  return /^[A-Z0-9()-]{1,20}$/.test(code) ? { kind: 'code', code } : null;
}

export type LabelData = { id: string; code: string; strain: string; madeOn: string; initials: string };

export type LabelSize = 'brother-29x90' | 'brother-62x29' | 'avery-5160';

export const LABEL_SIZES: { value: LabelSize; label: string; hint: string }[] = [
  { value: 'brother-29x90', label: 'Brother 29 × 90 mm', hint: 'DK-1201 address labels, one per label' },
  { value: 'brother-62x29', label: 'Brother 62 × 29 mm', hint: 'DK-2205 continuous tape cut to 29 mm' },
  { value: 'avery-5160', label: 'Letter sheet, 30 labels', hint: 'Avery 5160 / 8160 (1 × 2⅝ in)' },
];

const PAGE: Record<LabelSize, { page: string; w: string; h: string; sheet: boolean }> = {
  'brother-29x90': { page: '90mm 29mm', w: '90mm', h: '29mm', sheet: false },
  'brother-62x29': { page: '62mm 29mm', w: '62mm', h: '29mm', sheet: false },
  'avery-5160': { page: 'letter', w: '2.625in', h: '1in', sheet: true },
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A print-ready HTML document: one label per page on Brother rolls, 3 × 10 on a letter sheet. */
export function labelsHtml(labels: LabelData[], size: LabelSize): string {
  const p = PAGE[size];
  const label = (l: LabelData) => `
    <div class="label">
      <div class="qr">${qrSvg(qrPayload(l.id))}</div>
      <div class="text">
        <div class="code">${esc(l.code)}</div>
        <div class="line">${esc(l.strain)}</div>
        <div class="line">${esc(labelDate(l.madeOn))} · ${esc(l.initials)}</div>
      </div>
    </div>`;
  const sheet = p.sheet
    ? `.sheet { display: grid; grid-template-columns: repeat(3, 2.625in); column-gap: 0.125in;
               padding: 0.5in 0.1875in 0; }
       .label { break-inside: avoid; }`
    : `.label { break-after: page; }`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Culture labels</title>
<style>
  @page { size: ${p.page}; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; }
  .label { width: ${p.w}; height: ${p.h}; display: flex; align-items: center; gap: 2mm; padding: 1.5mm 2mm; overflow: hidden; }
  .qr { height: 100%; aspect-ratio: 1; flex: none; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .text { min-width: 0; line-height: 1.15; }
  .code { font-weight: 800; font-size: 13pt; white-space: nowrap; }
  .line { font-size: 8pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ${sheet}
</style></head>
<body><div class="${p.sheet ? 'sheet' : 'roll'}">${labels.map(label).join('')}</div></body></html>`;
}
