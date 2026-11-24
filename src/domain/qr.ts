// QR codes as SVG, drawn from the qrcode library's module matrix. Pure JS, so the
// same code serves the screen (react-native-svg), print documents and tests.
import QRCode from 'qrcode';

/** The QR matrix: size × size, true = dark module. */
export function qrMatrix(text: string): { size: number; dark: (x: number, y: number) => boolean } {
  // M (15% recovery) survives smudged or wet labels in the grow room.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  return { size, dark: (x, y) => !!data[y * size + x] };
}

/** An SVG of the code with a 2-module quiet zone, scaled by its container. */
export function qrSvg(text: string): string {
  const { size, dark } = qrMatrix(text);
  const q = 2;
  let d = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (dark(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
    }
  }
  const n = size + 2 * q;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
