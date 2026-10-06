import { describe, expect, it } from 'vitest';
import { buildRows, rowJson, rowRaw, PEOPLE_COLUMNS, FACTS_COLUMNS, RELATIONSHIP_COLUMNS, SHORTENED_NOTE } from '../src/core/rows';
import { parseGedcom } from '../src/core/parser';
import { plainToRaw, splitCell, partCount, SAFE_CELL, toJson } from '../src/core/serialize';
import { splitName, surnameFirst } from '../src/core/names';
import { factLabel, recordLabel } from '../src/core/labels';
import type { CellValue, RowDesc, SheetRows } from '../src/core/types';
import { rowsFor } from './helpers';

const obj = (sheet: SheetRows, row: RowDesc): Record<string, CellValue> =>
  Object.fromEntries(sheet.columns.map((c, i) => [c.header, row.cells[i] ?? null]));

describe('names', () => {
  it('splits given /surname/ suffix without altering spelling', () => {
    expect(splitName('Bob /Example/ Jr.')).toEqual({ given: 'Bob', surname: 'Example', suffix: 'Jr.' });
    expect(splitName('/Solo/')).toEqual({ given: '', surname: 'Solo', suffix: '' });
    expect(splitName('Mononym')).toEqual({ given: 'Mononym', surname: '', suffix: '' });
    expect(surnameFirst({ given: 'Bob', surname: 'Example', suffix: 'Jr.' })).toBe('Example, Bob Jr.');
    expect(surnameFirst({ given: '', surname: 'Solo', suffix: '' })).toBe('Solo');
    expect(surnameFirst({ given: 'Ann', surname: '', suffix: '' })).toBe('Ann');
  });
  it('uses GIVN/SURN children when a part is empty', () => {
    const p = parseGedcom('0 @I1@ INDI\n1 NAME //\n2 GIVN Gwen\n2 SURN Child\n');
    const name = p.records[0]!.children[0]!;
    expect(splitName(name.value, name)).toEqual({ given: 'Gwen', surname: 'Child', suffix: '' });
  });
});

describe('labels', () => {
  it('labels standard, custom, unknown and standalone tags', () => {
    expect(factLabel('BIRT')).toBe('Birth');
    expect(factLabel('_MILT')).toBe('Military service (custom _MILT)');
    expect(factLabel('_ZZ')).toBe('Custom tag _ZZ');
    expect(factLabel('ZZZX')).toBe('Unknown tag ZZZX');
    expect(factLabel('FAMC')).toBe('Family link (child)');
    expect(recordLabel('SOUR')).toBe('Source record');
    expect(recordLabel('_CUSTOM')).toBe('_CUSTOM record');
  });
});

describe('People sheet', () => {
  const { parse, rows } = rowsFor('basic.ged');
  const people = rows.people;
  const byId = (id: string) => obj(people, people.rows.find((r) => r.cells[0] === id)!);

  it('has the exact columns and one row per INDI in file order', () => {
    expect(people.columns.map((c) => c.header)).toEqual([
      'Person ID', 'Name (surname first)', 'Primary name', 'Surname', 'Given names', 'Suffix', 'Recorded sex',
      'All names', 'Name count', 'Private', 'Restriction', 'Source line',
    ]);
    expect(people.columns).toBe(PEOPLE_COLUMNS);
    expect(people.rows.map((r) => r.cells[0])).toEqual(['@I1@', '@I2@', '@I3@', '@I4@', '@I5@', '@I6@']);
  });

  it('fills name, sex and privacy columns', () => {
    const a = byId('@I1@');
    expect(a).toMatchObject({
      'Name (surname first)': 'Example, Alice',
      'Primary name': 'Alice /Example/',
      Surname: 'Example',
      'Given names': 'Alice',
      Suffix: null,
      'Recorded sex': 'F',
      'All names': 'Alice /Example/ | Ally /Example/',
      'Name count': '2',
      Private: 'No',
      Restriction: null,
      'Source line': parse.xrefIndex.get('@I1@')![0]!.line,
    });
    expect(byId('@I2@')).toMatchObject({ 'Name (surname first)': 'Example, Bob Jr.', Suffix: 'Jr.', Private: 'Yes', Restriction: 'privacy' });
    expect(byId('@I4@')).toMatchObject({ 'Name (surname first)': 'Solo', Surname: 'Solo', 'Given names': null, 'Recorded sex': null });
    expect(byId('@I5@')).toMatchObject({ 'Name (surname first)': null, 'Primary name': null, 'Name count': '0', 'Recorded sex': 'U' });
  });

  it('serialises the whole record', () => {
    const r = people.rows[0]!;
    expect(rowRaw(r).split('\n')[0]).toBe('0 @I1@ INDI');
    expect(JSON.parse(rowJson(r))).toMatchObject({ level: 0, tag: 'INDI', id: '@I1@' });
  });
});

describe('Facts sheet', () => {
  const { parse, rows } = rowsFor('basic.ged');
  const facts = rows.facts;
  const all = facts.rows.map((r) => obj(facts, r));

  it('has the exact columns and sequential IDs', () => {
    expect(facts.columns).toBe(FACTS_COLUMNS);
    expect(facts.columns.map((c) => c.header)).toEqual([
      'Fact ID', 'Owner type', 'Owner ID', 'Record type', 'Tag', 'Fact type', 'Type detail', 'Value', 'Date', 'Place',
      'Private', 'Restriction', 'Owner restriction', 'Source line',
    ]);
    expect(all.length).toBe(42);
    all.forEach((f, i) => expect(f['Fact ID']).toBe(`FACT-${String(i + 1).padStart(6, '0')}`));
  });

  it('keeps every level-1 fact except NAME/SEX/RESN for people', () => {
    const i1 = all.filter((f) => f['Owner ID'] === '@I1@').map((f) => f.Tag);
    expect(i1).toEqual(['BIRT', 'BIRT', '_MILT', '_MDCL', 'SSN', 'EMAIL', 'ADDR', 'OCCU', 'FAMS', 'FAMS', 'NOTE', 'OBJE']);
    const i2 = all.filter((f) => f['Owner ID'] === '@I2@').map((f) => f.Tag);
    expect(i2).toEqual(['DEAT', 'EVEN', 'PHON', 'FAMS', 'FAMS']);
  });

  it('keeps conflicting dates, custom and unknown tags, FAMC, EVEN type detail', () => {
    const births = all.filter((f) => f['Owner ID'] === '@I1@' && f.Tag === 'BIRT');
    expect(births.map((b) => b.Date)).toEqual(['ABT 1900', 'BET 1899 AND 1901']);
    expect(births[0]!.Place).toBe('Springfield, Example County');
    const milt = all.find((f) => f.Tag === '_MILT')!;
    expect(milt).toMatchObject({ 'Fact type': 'Military service (custom _MILT)', Value: 'Army nurse', Date: '1918', Place: 'Fort Example' });
    expect(all.find((f) => f.Tag === 'ZZZX')).toMatchObject({ 'Fact type': 'Unknown tag ZZZX', Value: 'something' });
    expect(all.find((f) => f.Tag === 'FAMC' && f['Owner ID'] === '@I3@')).toMatchObject({ 'Fact type': 'Family link (child)', Value: '@F1@' });
    expect(all.find((f) => f.Tag === 'EVEN')).toMatchObject({ 'Type detail': 'Relocation', Value: 'Moved house', Date: '1950' });
    expect(all.find((f) => f.Tag === 'ADDR')!.Value).toBe('12 Example Street\nSpringfield');
    expect(all.find((f) => f.Tag === 'OCCU')!.Value).toBe('=SUM(A1:A2)');
    const weird = facts.rows.find((r) => r.cells[4] === 'ZZZX')!;
    expect(rowJson(weird)).toContain('"tag":"_WEIRD"');
  });

  it('derives fact-level and inherited privacy', () => {
    const i3 = all.filter((f) => f['Owner ID'] === '@I3@');
    expect(i3.find((f) => f.Tag === 'BIRT')).toMatchObject({ Private: 'Yes', Restriction: 'privacy', 'Owner restriction': null });
    expect(i3.find((f) => f.Tag === 'RESI')).toMatchObject({ Private: 'No', Restriction: 'locked' });
    expect(all.find((f) => f['Owner ID'] === '@I2@' && f.Tag === 'DEAT')).toMatchObject({
      Private: 'Yes', Restriction: null, 'Owner restriction': 'privacy',
    });
  });

  it('adds family facts including the family restriction', () => {
    const f2 = all.filter((f) => f['Owner ID'] === '@F2@');
    expect(f2.map((f) => f.Tag)).toEqual(['RESN', 'DIV']);
    expect(f2[0]).toMatchObject({ 'Owner type': 'Family', 'Record type': 'FAM', Restriction: 'confidential', Private: 'No' });
    expect(f2[1]).toMatchObject({ 'Owner restriction': 'confidential' });
  });

  it('adds standalone records with generated IDs', () => {
    const lastLine = parse.records.at(-1)!.line;
    expect(all[0]).toMatchObject({ 'Owner type': 'Standalone record', 'Owner ID': 'HEAD:L1', 'Record type': 'HEAD', Tag: 'HEAD', 'Fact type': 'Header', 'Source line': 1 });
    expect(all.at(-1)).toMatchObject({ 'Owner ID': `TRLR:L${lastLine}`, 'Fact type': 'Trailer' });
    const note = all.find((f) => f['Owner ID'] === '@N1@')!;
    expect(note).toMatchObject({ 'Fact type': 'Note record', Value: 'This is a long note that is split across lines\nand continues on a new line.' });
    expect(all.find((f) => f['Owner ID'] === '@S1@')).toMatchObject({ 'Fact type': 'Source record', 'Owner restriction': null });
  });

  it('adds malformed lines as rows', () => {
    const m = rowsFor('malformed.ged').rows.facts;
    const bad = m.rows.filter((r) => r.cells[1] === 'Malformed line').map((r) => obj(m, r));
    expect(bad.map((b) => b['Owner ID'])).toEqual(['LINE:1', 'LINE:8', 'LINE:10', 'LINE:11', 'LINE:15', 'LINE:16']);
    expect(bad[1]).toMatchObject({ 'Record type': null, Tag: null, 'Fact type': 'Malformed or unparsed line', Value: 'NAME Bob', 'Source line': 8 });
    const row = m.rows.find((r) => r.cells[2] === 'LINE:8')!;
    expect(JSON.parse(rowJson(row))).toEqual({ line: 8, raw: 'NAME Bob', problem: 'Does not match level/tag structure' });
    expect(rowRaw(row)).toBe('NAME Bob');
  });

  it('standalone records without IDs get TAG:L<line>', () => {
    const s = rowsFor('standalone.ged').rows.facts;
    expect(s.rows.map((r) => r.cells[2])).toEqual(['HEAD:L1', '_CUSTOMREC:L5', '@X1@', 'TRLR:L9']);
    expect(s.rows[1]!.cells[5]).toBe('_CUSTOMREC record');
  });
});

describe('Relationships sheet', () => {
  const { rows } = rowsFor('basic.ged');
  const rel = rows.relationships;
  const all = rel.rows.map((r) => obj(rel, r));

  it('has the exact columns, roles and placeholder', () => {
    expect(rel.columns).toBe(RELATIONSHIP_COLUMNS);
    expect(rel.columns.map((c) => c.header)).toEqual([
      'Relationship ID', 'Family ID', 'Role', 'Original tag', 'Person ID', 'Private', 'Restriction', 'Family restriction', 'Source line',
    ]);
    expect(all.map((r) => [r['Relationship ID'], r['Family ID'], r.Role, r['Original tag'], r['Person ID']])).toEqual([
      ['REL-000001', '@F1@', 'Spouse 1', 'HUSB', '@I2@'],
      ['REL-000002', '@F1@', 'Spouse 2', 'WIFE', '@I1@'],
      ['REL-000003', '@F1@', 'Child', 'CHIL', '@I3@'],
      ['REL-000004', '@F1@', 'Child', 'CHIL', '@I4@'],
      ['REL-000005', '@F2@', 'Spouse 2', 'WIFE', '@I6@'],
      ['REL-000006', '@F3@', 'No recorded relationship links', null, null],
    ]);
    expect(all[4]).toMatchObject({ 'Family restriction': 'confidential', Private: 'No' });
    expect(rel.rows[5]!.placeholder).toBe(true);
    expect(rowRaw(rel.rows[5]!).split('\n')).toEqual(['0 @F3@ FAM', '1 RESN confidential', '1 NOTE A family with no recorded links']);
  });

  it('keeps _FREL/_MREL in the link metadata', () => {
    const j = JSON.parse(rowJson(rel.rows[3]!));
    expect(j.children.map((c: { tag: string; value: string }) => [c.tag, c.value])).toEqual([
      ['_FREL', 'Adopted'],
      ['_MREL', 'Adopted'],
    ]);
  });

  it('keeps unresolved person IDs verbatim and does not deduplicate', () => {
    const p = parseGedcom('0 @F1@ FAM\n1 CHIL @I404@\n1 CHIL @I404@\n2 RESN privacy\n');
    const r = buildRows(p).relationships.rows;
    expect(r.map((x) => x.cells[4])).toEqual(['@I404@', '@I404@']);
    expect(r.map((x) => x.cells[5])).toEqual(['No', 'Yes']);
  });
});

describe('lossless JSON', () => {
  it('JSON round-trips to the raw subtree for every row', () => {
    for (const fx of ['basic.ged', 'duplicates.ged', 'standalone.ged', 'long.ged']) {
      const { rows } = rowsFor(fx);
      for (const sheet of [rows.people, rows.facts, rows.relationships])
        for (const row of sheet.rows) {
          if (row.malformed) continue;
          expect(plainToRaw(JSON.parse(rowJson(row)))).toBe(rowRaw(row));
        }
    }
  });

  it('uses the fixed key order and omits empty fields', () => {
    const p = parseGedcom('0 @I5@ INDI\n1 NAME Lewis /Example/\n1 BIRT\n');
    expect(toJson(p.records[0]!)).toBe(
      '{"line":1,"level":0,"tag":"INDI","id":"@I5@","children":[{"line":2,"level":1,"tag":"NAME","value":"Lewis /Example/"},{"line":3,"level":1,"tag":"BIRT"}]}',
    );
  });
});

describe('splitCell', () => {
  it('returns the string itself when short', () => {
    expect(splitCell('abc')).toEqual(['abc']);
    expect(splitCell('x'.repeat(SAFE_CELL))).toHaveLength(1);
  });
  it('splits long strings into parts that rejoin', () => {
    const s = 'a'.repeat(SAFE_CELL * 2 + 5);
    const parts = splitCell(s);
    expect(parts.map((p) => p.length)).toEqual([SAFE_CELL, SAFE_CELL, 5]);
    expect(parts.join('')).toBe(s);
    expect(partCount(s)).toBe(3);
  });
  it('never splits a surrogate pair', () => {
    const s = 'a'.repeat(SAFE_CELL - 1) + '😀' + 'b';
    const parts = splitCell(s);
    expect(parts[0]!.length).toBe(SAFE_CELL - 1);
    expect(parts[1]).toBe('😀b');
    expect(parts.join('')).toBe(s);
    expect(partCount(s)).toBe(2);
  });
  it('long.ged forces at least 3 parts and shortens the display Value', () => {
    const { rows } = rowsFor('long.ged');
    const person = rows.people.rows[0]!;
    expect(splitCell(rowJson(person)).length).toBeGreaterThanOrEqual(3);
    expect(splitCell(rowRaw(person)).length).toBeGreaterThanOrEqual(3);
    const note = rows.facts.rows.find((r) => r.cells[4] === 'NOTE')!;
    const v = note.cells[7] as string;
    expect(v.length).toBeLessThanOrEqual(SAFE_CELL);
    expect(v.endsWith(SHORTENED_NOTE)).toBe(true);
    expect(note.shortenedCells).toBe(1);
  });
});
