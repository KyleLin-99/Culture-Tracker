import { describe, expect, it } from '@jest/globals';

import { csvField, culturesCsv, exportFileName } from '../export';

describe('csvField', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });
  it('leaves plain values and empties alone', () => {
    expect(csvField('TBG-2A')).toBe('TBG-2A');
    expect(csvField(null)).toBe('');
    expect(csvField(3)).toBe('3');
  });
  it('stops spreadsheet formulas from running', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('-5')).toBe('-5');
  });
});

describe('culturesCsv', () => {
  it('lists cultures with strain names and parent codes', () => {
    const csv = culturesCsv({
      lab: { name: 'Lab' },
      strains: [{ id: 's1', name: 'Blue Oyster' }],
      cultures: [
        { id: 'a', code: 'S', strain_id: 's1', kind: 'origin', medium: 'spore_print', status: 'active', parent_id: null, generation: 0, made_on: '2026-11-01', initials: 'KL', location: null, notes: 'First, ever' },
        { id: 'b', code: 'S-1', strain_id: 's1', kind: 'transfer', medium: 'agar', status: 'contaminated', parent_id: 'a', generation: 1, made_on: '2026-11-03', initials: 'KL', location: 'Shelf 2', notes: null },
      ],
    });
    expect(csv.split('\r\n')).toEqual([
      'code,strain,kind,medium,status,parent,generation,made_on,initials,location,notes',
      'S,Blue Oyster,origin,spore_print,active,,0,2026-11-01,KL,,"First, ever"',
      'S-1,Blue Oyster,transfer,agar,contaminated,S,1,2026-11-03,KL,Shelf 2,',
      '',
    ]);
  });
});

describe('exportFileName', () => {
  it('makes a safe name', () => {
    expect(exportFileName("Kyle's Lab #1", '2026-11-24', 'csv')).toBe('kyle-s-lab-1-2026-11-24.csv');
    expect(exportFileName('!!!', '2026-11-24', 'json')).toBe('lab-2026-11-24.json');
  });
});
