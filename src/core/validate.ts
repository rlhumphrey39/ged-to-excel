import type {
  BuiltRows,
  GedcomNode,
  ParseResult,
  RowDesc,
  SheetRows,
  UnresolvedReference,
  ValidationCheck,
  ValidationResult,
} from './types';
import { rowJson, rowRaw, recordId } from './rows';
import { SAFE_CELL, splitCell, partCount, walkTree } from './serialize';
import { isUnknownTag } from './labels';

const POINTER_RE = /^@[^@]+@$/;
// Mirrors what the parser accepts for a level-0 record line, but is a separate, regex-only scan of the text.
const INDI_LINE_RE = /^\s*0\s(?:@[^@\s]+@\s)?INDI(?:\s.*)?$/s;
const FAM_LINE_RE = /^\s*0\s(?:@[^@\s]+@\s)?FAM(?:\s.*)?$/s;
// Every serialised node appears in the JSON as {"line":N,"level":L,"tag":"T"...; values are escaped strings,
// so this pattern cannot match inside a value.
const JSON_NODE_RE = /"line":(\d+),"level":\d+,"tag":"([A-Za-z0-9_]+)"/g;

/** Independent INDI/FAM counts straight from the decoded text, without using the tree. */
export function independentCounts(text: string): { indi: number; fam: number } {
  let indi = 0;
  let fam = 0;
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;
    // Cheap pre-filter: record lines start with optional whitespace then "0".
    const c = text.charCodeAt(pos);
    if (c === 0x30 || c === 0x20 || c === 0x09 || c === 0xfeff) {
      let line = text.slice(pos, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      if (INDI_LINE_RE.test(line)) indi++;
      else if (FAM_LINE_RE.test(line)) fam++;
    }
    pos = nl + 1;
  }
  return { indi, fam };
}

export interface ValidateInput {
  parse: ParseResult;
  text: string;
  rows: BuiltRows;
}

interface SheetScan {
  maxMeta: number;
  maxRaw: number;
  longestMetaRow: RowDesc | undefined;
  longestMetaLen: number;
  longestRawRow: RowDesc | undefined;
  longestRawLen: number;
}

function fmtList<T>(items: T[], n = 20): string {
  const shown = items.slice(0, n).join(', ');
  return items.length > n ? `${shown}, … (${items.length} in total)` : shown;
}

export function validate(input: ValidateInput, onProgress?: (fraction: number) => void): ValidationResult {
  const { parse, text, rows } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: ValidationCheck[] = [];
  const add = (name: string, status: 'PASS' | 'WARN' | 'FAIL', detail: string) =>
    checks.push({ name, ok: status !== 'FAIL', status, detail });

  const sheets: SheetRows[] = [rows.people, rows.facts, rows.relationships];
  const totalRows = sheets.reduce((a, s) => a + s.rows.length, 0) || 1;

  // ---- One pass over every row: serialise, measure, collect tags/RESN lines from JSON, mark coverage.
  const covered = new Uint8Array(parse.totalLines + 2);
  const jsonTags = new Set<string>();
  const jsonResnLines = new Set<number>();
  const scans: SheetScan[] = [];
  let done = 0;
  for (const sheet of sheets) {
    const scan: SheetScan = {
      maxMeta: 1, maxRaw: 1, longestMetaRow: undefined, longestMetaLen: -1, longestRawRow: undefined, longestRawLen: -1,
    };
    for (const row of sheet.rows) {
      const json = rowJson(row);
      const raw = rowRaw(row);
      scan.maxMeta = Math.max(scan.maxMeta, partCount(json));
      scan.maxRaw = Math.max(scan.maxRaw, partCount(raw));
      if (json.length > scan.longestMetaLen) {
        scan.longestMetaLen = json.length;
        scan.longestMetaRow = row;
      }
      if (raw.length > scan.longestRawLen) {
        scan.longestRawLen = raw.length;
        scan.longestRawRow = row;
      }
      JSON_NODE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = JSON_NODE_RE.exec(json)) !== null) {
        jsonTags.add(m[2]!);
        if (m[2] === 'RESN') jsonResnLines.add(Number(m[1]));
      }
      // Coverage from the Raw GEDCOM source of the row.
      if (row.malformed) covered[row.malformed.line] = 1;
      else if (row.node) walkTree(row.node, (n) => (covered[n.line] = 1));
      done++;
      if (onProgress && done % 5000 === 0) onProgress(done / totalRows);
    }
    scans.push(scan);
  }

  // Index helpers
  const recordByLine = new Map<number, GedcomNode>();
  for (const r of parse.records) recordByLine.set(r.line, r);
  const malformedLines = new Set(parse.malformed.map((m) => m.line));
  const resolveGenerated = (id: string, tag: string): GedcomNode | undefined => {
    const mm = /^([A-Za-z0-9_]+):L(\d+)$/.exec(id);
    if (!mm) return undefined;
    const r = recordByLine.get(Number(mm[2]));
    return r && r.tag === mm[1] && r.tag === (tag || r.tag) && !r.xref ? r : undefined;
  };
  const resolveRecord = (id: string, tag?: string): GedcomNode | undefined => {
    const list = parse.xrefIndex.get(id);
    if (list) return list.find((r) => !tag || r.tag === tag);
    return resolveGenerated(id, tag ?? '');
  };

  // ---- 1. Independent counts
  const ind = independentCounts(text);
  {
    const ok = ind.indi === parse.indiCount && ind.fam === parse.famCount;
    const detail = `Text scan: ${ind.indi} INDI, ${ind.fam} FAM; parsed tree: ${parse.indiCount} INDI, ${parse.famCount} FAM`;
    add('1. Independent record count matches', ok ? 'PASS' : 'FAIL', detail);
    if (!ok) errors.push(`Record counts differ between the text scan and the parsed tree (${detail}).`);
  }

  // ---- 2. People rows <-> INDI records (object identity)
  {
    const indis = parse.records.filter((r) => r.tag === 'INDI');
    const seen = new Map<GedcomNode, number>();
    let bad = 0;
    for (const row of rows.people.rows) {
      if (!row.node || row.node.tag !== 'INDI' || row.node.level !== 0) bad++;
      else seen.set(row.node, (seen.get(row.node) ?? 0) + 1);
    }
    const missing = indis.filter((r) => seen.get(r) !== 1).length;
    const ok = bad === 0 && missing === 0 && rows.people.rows.length === indis.length;
    add(
      '2. One People row per person',
      ok ? 'PASS' : 'FAIL',
      `${rows.people.rows.length} People rows for ${indis.length} INDI records` +
        (ok ? '' : `; ${missing} person record(s) without exactly one row, ${bad} row(s) not mapping to a person`),
    );
    if (!ok) errors.push('The People sheet does not have exactly one row for every person record.');
  }

  // ---- 3. Every FAM has >= 1 Relationships row
  const famsInRel = new Set<GedcomNode>();
  for (const row of rows.relationships.rows) if (row.owner) famsInRel.add(row.owner);
  {
    const fams = parse.records.filter((r) => r.tag === 'FAM');
    const missing = fams.filter((f) => !famsInRel.has(f));
    const ok = missing.length === 0;
    add(
      '3. Every family has a Relationships row',
      ok ? 'PASS' : 'FAIL',
      `${famsInRel.size} of ${fams.length} families represented in ${rows.relationships.rows.length} rows` +
        (ok ? '' : `; missing: ${fmtList(missing.map(recordId))}`),
    );
    if (!ok) errors.push(`Some families have no row in the Relationships sheet (${missing.length}).`);
    // Family IDs in Relationships also represent each family's level-0 line (check 7).
    for (const row of rows.relationships.rows) {
      const famId = row.cells[1] as string;
      // Duplicate IDs: every FAM record carrying this ID is represented.
      const list = parse.xrefIndex.get(famId);
      if (list) for (const f of list) if (f.tag === 'FAM') covered[f.line] = 1;
      const generated = list ? undefined : resolveGenerated(famId, 'FAM');
      if (generated) covered[generated.line] = 1;
    }
  }

  // ---- 4. Facts Owner IDs resolve
  {
    const bad: string[] = [];
    for (const row of rows.facts.rows) {
      const ownerType = row.cells[1] as string;
      const ownerId = row.cells[2] as string;
      let ok = false;
      if (ownerType === 'Person') ok = !!resolveRecord(ownerId, 'INDI');
      else if (ownerType === 'Family') ok = !!resolveRecord(ownerId, 'FAM');
      else if (ownerType === 'Standalone record') ok = !!resolveRecord(ownerId, row.cells[3] as string);
      else if (ownerType === 'Malformed line') {
        const mm = /^LINE:(\d+)$/.exec(ownerId);
        ok = !!mm && malformedLines.has(Number(mm[1]));
      }
      if (!ok) bad.push(`${row.cells[0]}`);
    }
    const ok = bad.length === 0;
    add(
      '4. Every fact belongs to a known record',
      ok ? 'PASS' : 'FAIL',
      ok ? `${rows.facts.rows.length} Facts rows checked` : `Unresolved owners: ${fmtList(bad)}`,
    );
    if (!ok) errors.push(`Some Facts rows point to an owner that does not exist (${bad.length}).`);
  }

  // ---- 5. Relationships Person IDs resolve (file defect -> warning)
  {
    const bad: string[] = [];
    for (const row of rows.relationships.rows) {
      const pid = row.cells[4];
      if (typeof pid !== 'string' || pid === '') continue;
      if (!resolveRecord(pid, 'INDI')) bad.push(`line ${row.cells[8]}: ${pid}`);
    }
    if (bad.length === 0) add('5. Family links point to known people', 'PASS', 'All non-blank Person IDs resolve');
    else {
      add('5. Family links point to known people', 'WARN', `${bad.length} link(s) point to a missing person (kept as written): ${fmtList(bad)}`);
      warnings.push(`Family links pointing to a person who is not in the file: ${bad.length} (kept as written).`);
    }
  }

  // ---- 6. Duplicate IDs (warning)
  if (parse.duplicateIds.length === 0) add('6. Record IDs are unique', 'PASS', 'No duplicate IDs');
  else {
    add('6. Record IDs are unique', 'WARN', `Duplicate IDs (all records kept): ${fmtList(parse.duplicateIds)}`);
  }

  // ---- 7. Line coverage
  {
    const blank = new Set(parse.blankLineNumbers);
    for (const l of malformedLines) covered[l] = 1;
    const unmarked: number[] = [];
    for (let l = 1; l <= parse.totalLines; l++) if (!covered[l] && !blank.has(l)) unmarked.push(l);
    const ok = unmarked.length === 0;
    add(
      '7. Every line of the file is in the workbook',
      ok ? 'PASS' : 'FAIL',
      ok
        ? `${parse.totalLines - parse.blankLines} non-blank lines covered (${parse.blankLines} blank)`
        : `${unmarked.length} line(s) not represented; first: ${unmarked.slice(0, 20).join(', ')}`,
    );
    if (!ok) errors.push(`Some lines of the file are missing from the workbook: ${unmarked.slice(0, 20).join(', ')}`);
  }

  // ---- 8. Tag retention
  const treeTags = new Set<string>();
  let treeResn = 0;
  let privacyInTree = false;
  const unresolved: UnresolvedReference[] = [];
  let unresolvedCount = 0;
  for (const rec of parse.records) {
    walkTree(rec, (n) => {
      treeTags.add(n.tag);
      if (n.tag === 'RESN') {
        treeResn++;
        if (n.value.trim().toLowerCase() === 'privacy') privacyInTree = true;
      }
      if (POINTER_RE.test(n.value) && !parse.xrefIndex.has(n.value)) {
        unresolvedCount++;
        if (unresolved.length < 100) unresolved.push({ line: n.line, tag: n.tag, target: n.value });
      }
    });
  }
  {
    // A FAM record's level-0 line is represented by its Family ID in Relationships (as in check 7).
    const represented = new Set(jsonTags);
    if (famsInRel.size > 0) represented.add('FAM');
    const missing = [...treeTags].filter((t) => !represented.has(t)).sort();
    const custom = [...treeTags].filter((t) => t.startsWith('_')).length;
    const unknown = [...treeTags].filter(isUnknownTag).length;
    const ok = missing.length === 0;
    add(
      '8. Every tag is kept',
      ok ? 'PASS' : 'FAIL',
      ok
        ? `${treeTags.size} distinct tags kept, including ${custom} custom (_) and ${unknown} non-standard`
        : `Tags missing from All metadata: ${missing.join(', ')}`,
    );
    if (!ok) errors.push(`Some tags are missing from the workbook: ${missing.join(', ')}`);
  }

  // ---- 9. Privacy retention
  {
    const privRows = [rows.people, rows.facts, rows.relationships].reduce(
      (a, s) => a + s.rows.filter((r) => r.cells[s.name === 'People' ? 9 : s.name === 'Facts' ? 10 : 5] === 'Yes').length,
      0,
    );
    const countOk = jsonResnLines.size === treeResn;
    const privOk = !privacyInTree || privRows > 0;
    const ok = countOk && privOk;
    add(
      '9. Privacy restrictions are kept',
      ok ? 'PASS' : 'FAIL',
      `${treeResn} restriction (RESN) lines in the file, ${jsonResnLines.size} kept in All metadata; ${privRows} rows marked Private`,
    );
    if (!countOk) errors.push(`Restriction (RESN) lines lost: ${treeResn} in the file but ${jsonResnLines.size} in the workbook.`);
    if (!privOk) errors.push('The file marks some records as private but no row is marked Private.');
  }

  // ---- 10. No truncation
  {
    const problems: string[] = [];
    const details: string[] = [];
    sheets.forEach((sheet, i) => {
      const scan = scans[i]!;
      for (const [row, kind] of [
        [scan.longestMetaRow, 'metadata'],
        [scan.longestRawRow, 'raw'],
      ] as const) {
        if (!row) continue;
        const s = kind === 'metadata' ? rowJson(row) : rowRaw(row);
        const parts = splitCell(s);
        if (parts.some((p) => p.length > SAFE_CELL) || parts.join('') !== s)
          problems.push(`${sheet.name} ${kind}`);
      }
      details.push(`${sheet.name}: All metadata ${scan.maxMeta} part(s), Raw GEDCOM ${scan.maxRaw} part(s)`);
      for (const row of sheet.rows)
        for (const c of row.cells)
          if (typeof c === 'string' && c.length > 32767) problems.push(`${sheet.name} display cell over 32,767 characters`);
    });
    const ok = problems.length === 0;
    add('10. Nothing is cut short', ok ? 'PASS' : 'FAIL', ok ? details.join('; ') : `Problems: ${problems.join(', ')}`);
    if (!ok) errors.push(`Some cells would be cut short: ${problems.join(', ')}`);
  }

  if (unresolvedCount > 0) warnings.push(`References to records that are not in the file: ${unresolvedCount} (kept as written).`);

  return {
    errors,
    warnings,
    checks,
    unresolvedReferences: unresolved,
    unresolvedCount,
    maxParts: {
      people: { metadata: scans[0]!.maxMeta, raw: scans[0]!.maxRaw },
      facts: { metadata: scans[1]!.maxMeta, raw: scans[1]!.maxRaw },
      relationships: { metadata: scans[2]!.maxMeta, raw: scans[2]!.maxRaw },
    },
    customTagsRetained: [...treeTags].filter((t) => t.startsWith('_')).length,
    unknownTagsRetained: [...treeTags].filter(isUnknownTag).length,
    independentCounts: ind,
  };
}
