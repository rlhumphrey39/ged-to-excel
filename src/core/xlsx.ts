import { Zip, ZipDeflate } from 'fflate';
import type { CellValue, ColumnDef } from './types';

/**
 * Minimal streaming .xlsx (OOXML) writer. Sheet XML is generated row by row and pushed into an fflate
 * streaming zip, so a sheet is never held whole in memory as a string. Strings are always inline strings
 * (never formulas, never shared strings), so text such as "=SUM(A1)" or "007" is stored literally.
 */

export interface SheetSpec {
  name: string;
  columns: ColumnDef[];
  rowCount: number;
  rows: () => Iterable<CellValue[]>;
}

// OOXML namespace and relationship-type URIs. These are identifiers, not network addresses; the
// no-network test allows exactly these literals.
export const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const NS_CORE = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
export const NS_EXT = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
export const NS_DC = 'http://purl.org/dc/elements/1.1/';
export const NS_DCTERMS = 'http://purl.org/dc/terms/';
export const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
export const REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
export const REL_EXT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
export const REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
export const REL_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

export const OOXML_URIS = [
  NS_MAIN, NS_REL, NS_PKG_REL, NS_CT, NS_CORE, NS_EXT, NS_DC, NS_DCTERMS, NS_XSI,
  REL_DOC, REL_CORE, REL_EXT, REL_SHEET, REL_STYLES,
];

export const MAX_COLUMNS = 16384;

/** Excel column letters for a 0-based index. */
export function colLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const NEEDS_WORK = /[&<>"\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\uD800-\uDFFF￾￿]|_x[0-9A-Fa-f]{4}_/;

const hex4 = (c: number) => c.toString(16).toUpperCase().padStart(4, '0');

/** Escape text for an XML text node. Returns the escaped string and how many _xHHHH_ substitutions were made. */
export function escapeXmlText(s: string): { text: string; substitutions: number } {
  if (!NEEDS_WORK.test(s)) return { text: s, substitutions: 0 };
  let out = '';
  let subs = 0;
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x26) out += '&amp;';
    else if (c === 0x3c) out += '&lt;';
    else if (c === 0x3e) out += '&gt;';
    else if (c === 0x22) out += '&quot;';
    else if (c === 0x5f && s.charCodeAt(i + 1) === 0x78 && /^_x[0-9A-Fa-f]{4}_/.test(s.slice(i, i + 7))) {
      // A literal "_xHHHH_" in the data: escape its underscore so Excel does not decode it.
      out += '_x005F_';
      subs++;
    } else if (
      (c < 0x20 && c !== 0x09 && c !== 0x0a) || // control chars (CR too: XML would turn it into LF)
      c === 0xfffe ||
      c === 0xffff
    ) {
      out += `_x${hex4(c)}_`;
      subs++;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      } else {
        out += `_x${hex4(c)}_`;
        subs++;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += `_x${hex4(c)}_`; // lone low surrogate
      subs++;
    } else out += s[i]!;
  }
  return { text: out, substitutions: subs };
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Style indexes in styles.xml cellXfs
const S_WRAP = 1;
const S_TEXT = 2;
const S_NUM = 3;
const S_HEADER = 4;

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

class ChunkWriter {
  private parts: string[] = [];
  private size = 0;
  constructor(private file: ZipDeflate, private enc: TextEncoder) {}
  write(s: string) {
    this.parts.push(s);
    this.size += s.length;
    if (this.size >= 1 << 18) this.flush(false);
  }
  flush(final: boolean) {
    const s = this.parts.join('');
    this.parts = [];
    this.size = 0;
    this.file.push(this.enc.encode(s), final);
  }
}

export interface WriteResult {
  bytes: Uint8Array;
  xmlSubstitutions: number;
}

/** Write a workbook. Sheets appear in the given order. */
export async function writeWorkbook(
  sheets: SheetSpec[],
  onProgress?: (done: number, total: number) => void,
): Promise<WriteResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((err, data, final) => {
    if (err) {
      zipError = err;
      return;
    }
    chunks.push(data);
    total += data.length;
    if (final) finished = true;
  });
  const enc = new TextEncoder();
  const addFile = (name: string, content: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(enc.encode(content), true);
  };

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sheetEntries = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');
  addFile(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<Types xmlns="${NS_CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheetEntries +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  addFile(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_DOC}" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_CORE}" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${REL_EXT}" Target="docProps/app.xml"/>` +
      '</Relationships>',
  );
  addFile(
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<cp:coreProperties xmlns:cp="${NS_CORE}" xmlns:dc="${NS_DC}" xmlns:dcterms="${NS_DCTERMS}" xmlns:xsi="${NS_XSI}">` +
      '<dc:title>Family tree workbook</dc:title>' +
      '<dc:creator>GED to Excel (in-browser)</dc:creator>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      '</cp:coreProperties>',
  );
  addFile(
    'docProps/app.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<Properties xmlns="${NS_EXT}"><Application>GED to Excel</Application></Properties>`,
  );

  const lastRef = (s: SheetSpec) => `${colLetter(s.columns.length - 1)}${s.rowCount + 1}`;
  const quoteSheet = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const defined = sheets
    .map(
      (s, i) =>
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${attr(quoteSheet(s.name))}!$A$1:$${colLetter(s.columns.length - 1)}$${s.rowCount + 1}</definedName>`,
    )
    .join('');
  addFile(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>' +
      '<sheets>' +
      sheets.map((s, i) => `<sheet name="${attr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      `<definedNames>${defined}</definedNames>` +
      '</workbook>',
  );
  addFile(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_SHEET}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` +
      '</Relationships>',
  );
  addFile('xl/styles.xml', STYLES_XML);

  let substitutions = 0;
  const totalRows = sheets.reduce((a, s) => a + s.rowCount, 0);
  let doneRows = 0;

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si]!;
    if (sheet.columns.length > MAX_COLUMNS) throw new Error(`Sheet ${sheet.name} needs more than ${MAX_COLUMNS} columns`);
    const letters = sheet.columns.map((_, i) => colLetter(i));
    const styleOf = sheet.columns.map((c) => (c.numeric ? S_NUM : c.wrap ? S_WRAP : S_TEXT));
    const f = new ZipDeflate(`xl/worksheets/sheet${si + 1}.xml`, { level: 6 });
    zip.add(f);
    const w = new ChunkWriter(f, enc);
    w.write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<dimension ref="A1:${lastRef(sheet)}"/>` +
        '<sheetViews><sheetView workbookViewId="0"' +
        (si === 0 ? ' tabSelected="1"' : '') +
        '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        '<cols>' +
        sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('') +
        '</cols><sheetData>',
    );
    // Header
    let hdr = '<row r="1" ht="30" customHeight="1">';
    for (let i = 0; i < sheet.columns.length; i++) {
      const e = escapeXmlText(sheet.columns[i]!.header);
      substitutions += e.substitutions;
      hdr += `<c r="${letters[i]}1" s="${S_HEADER}" t="inlineStr"><is><t xml:space="preserve">${e.text}</t></is></c>`;
    }
    w.write(hdr + '</row>');

    let r = 1;
    for (const cells of sheet.rows()) {
      r++;
      let x = `<row r="${r}">`;
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i];
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'number') {
          x += `<c r="${letters[i]}${r}" s="${styleOf[i]}"><v>${v}</v></c>`;
        } else {
          const e = escapeXmlText(v);
          substitutions += e.substitutions;
          x += `<c r="${letters[i]}${r}" s="${styleOf[i]}" t="inlineStr"><is><t xml:space="preserve">${e.text}</t></is></c>`;
        }
      }
      w.write(x + '</row>');
      doneRows++;
      if (onProgress && doneRows % 2000 === 0) onProgress(doneRows, totalRows);
    }
    if (r - 1 !== sheet.rowCount)
      throw new Error(`Sheet ${sheet.name}: wrote ${r - 1} rows but expected ${sheet.rowCount}`);
    w.write(
      '</sheetData>' +
        `<autoFilter ref="A1:${lastRef(sheet)}"/>` +
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        '</worksheet>',
    );
    w.flush(true);
  }
  zip.end();
  if (zipError) throw zipError;
  if (!finished) throw new Error('Zip stream did not finish');
  onProgress?.(totalRows, totalRows);

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return { bytes: out, xmlSubstitutions: substitutions };
}
