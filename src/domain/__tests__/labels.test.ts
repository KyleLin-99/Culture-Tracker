import { describe, expect, it } from '@jest/globals';
import jsQR from 'jsqr';

import { labelsHtml, parseScan, qrPayload } from '../labels';
import { qrMatrix, qrSvg } from '../qr';

const ID = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b';

/** Reads a QR code back the way a camera would: draw it as pixels, decode with jsQR. */
function decode(text: string): string | undefined {
  const { size, dark } = qrMatrix(text);
  const scale = 4;
  const quiet = 4;
  const n = (size + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!dark(x, y)) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = (((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(px, n, n)?.data;
}

describe('QR codes', () => {
  it('scan back to the culture link', () => {
    expect(decode(qrPayload(ID))).toBe(`culturetracker://items/${ID}`);
  });

  it('are small enough to read on a 29 mm label', () => {
    // 45 characters at level M fits a version 3 code: 29 × 29 modules, about 0.8 mm each at 25 mm.
    expect(qrMatrix(qrPayload(ID)).size).toBeLessThanOrEqual(33);
  });

  it('draw as an SVG with a quiet zone', () => {
    const svg = qrSvg(qrPayload(ID));
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 (\d+) \1"/);
    expect(svg).toContain('fill="#000"');
  });
});

describe('reading a scan', () => {
  it('opens the culture from our QR link, any link to it, or a bare id', () => {
    expect(parseScan(qrPayload(ID))).toEqual({ kind: 'item', id: ID });
    expect(parseScan(`https://lab.example.com/items/${ID.toUpperCase()}?x=1`)).toEqual({ kind: 'item', id: ID });
    expect(parseScan(`  ${ID} `)).toEqual({ kind: 'item', id: ID });
  });

  it('looks up a code typed or printed as text', () => {
    expect(parseScan(' s-2a1(2) ')).toEqual({ kind: 'code', code: 'S-2A1(2)' });
  });

  it('ignores other QR codes and junk', () => {
    expect(parseScan('https://example.com/menu')).toBeNull();
    expect(parseScan('WIFI:S:lab;T:WPA;P:secret;;')).toBeNull();
    expect(parseScan('')).toBeNull();
  });
});

describe('label document', () => {
  const label = { id: ID, code: 'S-2A1', strain: 'Blue <Oyster> & Co', madeOn: '2026-11-23', initials: 'KL' };

  it('has strain, date, initials and code, safely escaped', () => {
    const html = labelsHtml([label], 'brother-29x90');
    expect(html).toContain('<div class="code">S-2A1</div>');
    expect(html).toContain('Blue &lt;Oyster&gt; &amp; Co');
    expect(html).toContain('11/23/26 · KL');
    expect(html).toContain('size: 90mm 29mm');
  });

  it('puts one label per page on a roll and 30 to a letter sheet', () => {
    expect(labelsHtml([label, label], 'brother-62x29')).toContain('break-after: page');
    const sheet = labelsHtml([label], 'avery-5160');
    expect(sheet).toContain('size: letter');
    expect(sheet).toContain('grid-template-columns: repeat(3, 2.625in)');
  });
});
