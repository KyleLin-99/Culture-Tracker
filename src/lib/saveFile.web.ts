/** Web: download the text as a file. */
export async function saveTextFile(name: string, text: string): Promise<void> {
  const type = name.endsWith('.csv') ? 'text/csv' : 'application/json';
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
