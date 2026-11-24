// Web: print the label document from a hidden frame, so the app itself isn't printed.
// (expo-print on web only prints the current page.)
export async function printHtml(html: string): Promise<void> {
  document.getElementById('label-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'label-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
}
