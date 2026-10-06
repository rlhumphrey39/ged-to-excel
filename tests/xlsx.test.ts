import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { convert } from '../src/core/convert';
import { escapeXmlText, colLetter, writeWorkbook } from '../src/core/xlsx';
import { fixtureBytes } from './helpers';

async function load(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

async function convertFixture(name: string) {
  const r = await convert({ name, bytes: fixtureBytes(name) });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r;
}

const headers = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as unknown[]).slice(1);
const text = (c: ExcelJS.Cell) => (c.value === null || c.value === undefined ? null : c.value);

describe('xlsx writer', () => {
  it('writes basic.ged and reads back with exceljs', async () => {
    const r = await convertFixture('basic.ged');
    const wb = await load(r.workbook);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['People', 'Facts', 'Relationships']);
    const [people, facts, rel] = wb.worksheets as [ExcelJS.Worksheet, ExcelJS.Worksheet, ExcelJS.Worksheet];
    expect(people.rowCount).toBe(7);
    expect(facts.rowCount).toBe(43);
    expect(rel.rowCount).toBe(7);
    expect(headers(people)).toEqual([
      'Person ID', 'Name (surname first)', 'Primary name', 'Surname', 'Given names', 'Suffix', 'Recorded sex',
      'All names', 'Name count', 'Private', 'Restriction', 'Source line', 'All metadata 1', 'Raw GEDCOM 1',
    ]);
    expect(headers(facts)).toEqual([
      'Fact ID', 'Owner type', 'Owner ID', 'Record type', 'Tag', 'Fact type', 'Type detail', 'Value', 'Date', 'Place',
      'Private', 'Restriction', 'Owner restriction', 'Source line', 'All metadata 1', 'Raw GEDCOM 1',
    ]);
    expect(headers(rel)).toEqual([
      'Relationship ID', 'Family ID', 'Role', 'Original tag', 'Person ID', 'Private', 'Restriction',
      'Family restriction', 'Source line', 'All metadata 1', 'Raw GEDCOM 1',
    ]);
    expect(text(people.getCell('A2'))).toBe('@I1@');
    expect(text(people.getCell('D2'))).toBe('Example');
    expect(text(people.getCell('J3'))).toBe('Yes');
    expect(people.getCell('L2').value).toBe(17);
    expect(typeof people.getCell('L2').value).toBe('number');
    expect(text(rel.getCell('C2'))).toBe('Spouse 1');
    expect(text(rel.getCell('C7'))).toBe('No recorded relationship links');
    const factRows = facts.getSheetValues() as unknown[][];
    const birth = factRows.find((row) => row && row[3] === '@I1@' && row[5] === 'BIRT')!;
    expect(birth[9]).toBe('ABT 1900');
    // Formula-looking values are stored as literal strings
    const values = new Set<unknown>();
    for (const ws of [people, facts, rel]) ws.eachRow((row) => row.eachCell((c) => values.add(c.value)));
    for (const v of ['=SUM(A1:A2)', '007', '+1 555 0100', '-5', '@home']) expect(values.has(v), v).toBe(true);
    for (const ws of [people, facts, rel]) ws.eachRow((row) => row.eachCell((c) => {
      expect(c.type).not.toBe(ExcelJS.ValueType.Formula);
      if (typeof c.value === 'string') expect(c.value.length).toBeLessThanOrEqual(32767);
    }));
    // All metadata parses back to the JSON
    const meta = JSON.parse(String(people.getCell('M2').value));
    expect(meta).toMatchObject({ line: 17, level: 0, tag: 'INDI', id: '@I1@' });
    expect(String(people.getCell('N2').value).split('\n')[0]).toBe('0 @I1@ INDI');
  });

  it('has autofilter, frozen header and widths', async () => {
    const r = await convertFixture('basic.ged');
    const wb = await load(r.workbook);
    for (const ws of wb.worksheets) {
      expect(ws.autoFilter).toBeTruthy();
      expect(ws.views[0]!.state).toBe('frozen');
      expect((ws.views[0] as { ySplit?: number }).ySplit).toBe(1);
    }
    const people = wb.getWorksheet('People')!;
    expect(people.autoFilter).toBe('A1:N7');
    expect(people.getColumn(1).width).toBe(12);
    expect(people.getColumn(13).width).toBe(60);
    const files = unzipSync(r.workbook);
    const wbXml = strFromU8(files['xl/workbook.xml']!);
    expect(wbXml).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'People'!$A$1:$N$7</definedName>`);
    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet1).not.toContain('<f>');
    expect(sheet1).toContain('t="inlineStr"');
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml',
    ]);
  });

  it('long.ged yields All metadata 1..N (N >= 3) whose join equals the JSON', async () => {
    const r = await convertFixture('long.ged');
    const wb = await load(r.workbook);
    const people = wb.getWorksheet('People')!;
    const hs = headers(people) as string[];
    const metaCols = hs.map((h, i) => [h, i + 1] as const).filter(([h]) => h.startsWith('All metadata'));
    const rawCols = hs.map((h, i) => [h, i + 1] as const).filter(([h]) => h.startsWith('Raw GEDCOM'));
    expect(metaCols.length).toBeGreaterThanOrEqual(3);
    expect(metaCols.map(([h]) => h)).toEqual(metaCols.map((_, i) => `All metadata ${i + 1}`));
    expect(rawCols.length).toBeGreaterThanOrEqual(3);
    const joined = metaCols.map(([, c]) => String(people.getRow(2).getCell(c).value ?? '')).join('');
    const parsed = JSON.parse(joined);
    expect(parsed.tag).toBe('INDI');
    expect(parsed.children[1].children).toHaveLength(400);
    const raw = rawCols.map(([, c]) => String(people.getRow(2).getCell(c).value ?? '')).join('');
    expect(raw.split('\n')).toHaveLength(403); // INDI + NAME + NOTE + 400 CONC
    for (const ws of wb.worksheets)
      ws.eachRow((row) => row.eachCell((c) => {
        if (typeof c.value === 'string') expect(c.value.length).toBeLessThanOrEqual(32767);
      }));
  });

  it('escapes XML and Excel _xHHHH_ sequences', () => {
    expect(escapeXmlText('a & <b> "c"')).toEqual({ text: 'a &amp; &lt;b&gt; &quot;c&quot;', substitutions: 0 });
    expect(escapeXmlText('x\u0001y')).toEqual({ text: 'x_x0001_y', substitutions: 1 });
    expect(escapeXmlText('_x0041_')).toEqual({ text: '_x005F_x0041_', substitutions: 1 });
    expect(escapeXmlText('a\rb')).toEqual({ text: 'a_x000D_b', substitutions: 1 });
    expect(escapeXmlText('😀')).toEqual({ text: '😀', substitutions: 0 });
    expect(escapeXmlText('\uD800x')).toEqual({ text: '_xD800_x', substitutions: 1 });
    expect(escapeXmlText('tab\tnl\n')).toEqual({ text: 'tab\tnl\n', substitutions: 0 });
  });

  it('computes column letters', () => {
    expect([0, 25, 26, 51, 52, 701, 702, 16383].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA', 'XFD']);
  });

  it('round-trips awkward text through exceljs', async () => {
    const values = ['=1+1', '<tag> & "q"', 'line1\nline2', 'tab\there', '  padded  ', 'ünïcödé 😀'];
    const out = await writeWorkbook([
      {
        name: 'People',
        columns: [{ header: 'A', width: 10, wrap: false }],
        rowCount: values.length,
        rows: () => values.map((v) => [v]),
      },
    ]);
    const wb = await load(out.bytes);
    const got = values.map((_, i) => wb.worksheets[0]!.getCell(`A${i + 2}`).value);
    expect(got).toEqual(values);
  });
});
