// Turns a lab export (the export_lab() JSON) into a spreadsheet-friendly CSV of cultures.

type Row = Record<string, unknown>;
export type LabExport = { lab: { name: string }; strains: Row[]; cultures: Row[] };

const COLUMNS = ['code', 'strain', 'kind', 'medium', 'status', 'parent', 'generation', 'made_on', 'initials', 'location', 'notes'] as const;

/** One CSV field: quoted when it holds a comma, quote or line break; guards spreadsheet formulas. */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // A cell starting with = + - @ would be run as a formula by Excel/Sheets.
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function culturesCsv(data: LabExport): string {
  const strain = new Map(data.strains.map((s) => [String(s.id), String(s.name)]));
  const code = new Map(data.cultures.map((c) => [String(c.id), String(c.code)]));
  const lines = [COLUMNS.join(',')];
  for (const c of data.cultures) {
    const row: Record<(typeof COLUMNS)[number], unknown> = {
      code: c.code,
      strain: strain.get(String(c.strain_id)) ?? '',
      kind: c.kind,
      medium: c.medium,
      status: c.status,
      parent: c.parent_id ? code.get(String(c.parent_id)) ?? '' : '',
      generation: c.generation,
      made_on: c.made_on,
      initials: c.initials,
      location: c.location,
      notes: c.notes,
    };
    lines.push(COLUMNS.map((k) => csvField(row[k])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** A file-name-safe version of the lab's name plus the date. */
export function exportFileName(labName: string, today: string, ext: 'json' | 'csv'): string {
  const slug = labName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lab';
  return `${slug}-${today}.${ext}`;
}
