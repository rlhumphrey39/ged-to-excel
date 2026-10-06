import type { BuiltRows, CellValue, ConversionSummary, ConvertResult, ProgressEvent, SheetRows, Stage } from './types';
import { decodeGedcom, type EncodingOverride } from './encoding';
import { parseGedcom } from './parser';
import { buildRows, metadataColumns, rowJson, rowRaw } from './rows';
import { splitCell } from './serialize';
import { validate } from './validate';
import { writeWorkbook, type SheetSpec } from './xlsx';
import { sha256Hex } from './sha256';
import { renderReport } from './report';

export interface ConvertOptions {
  encodingOverride?: EncodingOverride | string;
  /** Test hook: mutate the built rows before validation (used to prove validation blocks bad output). */
  afterRows?: (rows: BuiltRows) => void;
}

export interface ConvertInput {
  name: string;
  bytes: Uint8Array;
}

// Overall progress ranges per stage.
const RANGES: Record<Stage, [number, number]> = {
  reading: [0, 8],
  parsing: [8, 35],
  checking: [35, 55],
  writing: [55, 100],
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function sheetSpec(sheet: SheetRows, metaParts: number, rawParts: number): SheetSpec {
  return {
    name: sheet.name,
    columns: [...sheet.columns, ...metadataColumns(metaParts, rawParts)],
    rowCount: sheet.rows.length,
    rows: function* () {
      for (const row of sheet.rows) {
        const meta = splitCell(rowJson(row));
        const raw = splitCell(rowRaw(row));
        const out: CellValue[] = row.cells.slice();
        for (let i = 0; i < metaParts; i++) out.push(meta[i] ?? null);
        for (let i = 0; i < rawParts; i++) out.push(raw[i] ?? null);
        yield out;
      }
    },
  };
}

export async function convert(
  file: ConvertInput,
  options: ConvertOptions = {},
  onProgress?: (p: ProgressEvent) => void,
): Promise<ConvertResult> {
  const t0 = now();
  const durations: Record<string, number> = {};
  const progress = (stage: Stage, fraction: number) => {
    if (!onProgress) return;
    const [a, b] = RANGES[stage];
    onProgress({ stage, percent: Math.round(a + (b - a) * Math.max(0, Math.min(1, fraction))) });
  };
  let t = now();
  const lap = (name: string) => {
    const x = now();
    durations[name] = x - t;
    t = x;
  };

  progress('reading', 0);
  const sha256 = await sha256Hex(file.bytes);
  lap('hash');
  progress('reading', 0.5);
  const decoded = decodeGedcom(file.bytes, options.encodingOverride ?? 'auto');
  lap('decode');
  progress('reading', 1);

  const parse = parseGedcom(decoded.text, {
    declaredCharset: decoded.declaredCharset,
    usedEncoding: decoded.usedEncoding,
    onProgress: (f) => progress('parsing', f),
  });
  lap('parse');

  progress('checking', 0);
  const rows = buildRows(parse);
  options.afterRows?.(rows);
  lap('rows');
  const v = validate({ parse, text: decoded.text, rows }, (f) => progress('checking', f));
  lap('validate');
  progress('checking', 1);

  const otherRecordsByTag: Record<string, number> = {};
  let otherRecords = 0;
  for (const r of parse.records) {
    if (r.tag === 'INDI' || r.tag === 'FAM') continue;
    otherRecords++;
    otherRecordsByTag[r.tag] = (otherRecordsByTag[r.tag] ?? 0) + 1;
  }
  const shortened = [rows.people, rows.facts, rows.relationships].reduce(
    (a, s) => a + s.rows.reduce((b, r) => b + (r.shortenedCells ?? 0), 0),
    0,
  );
  const warnings = [...decoded.warnings, ...parse.warnings, ...v.warnings];
  if (shortened > 0)
    warnings.push(
      `Display cells shortened to fit one Excel cell: ${shortened} (the full text is in the All metadata and Raw GEDCOM columns).`,
    );

  const summary: ConversionSummary = {
    fileName: file.name,
    sizeBytes: file.bytes.length,
    sha256,
    gedcomVersion: parse.version,
    declaredCharset: decoded.declaredCharset,
    usedEncoding: decoded.usedEncoding,
    sourceProgram: parse.sourceProgram,
    people: rows.people.rows.length,
    families: parse.famCount,
    otherRecords,
    otherRecordsByTag,
    factRows: rows.facts.rows.length,
    relationshipRows: rows.relationships.rows.length,
    placeholderRows: rows.relationships.rows.filter((r) => r.placeholder).length,
    familiesInRelationships: new Set(rows.relationships.rows.map((r) => r.owner)).size,
    unresolvedReferences: { count: v.unresolvedCount, list: v.unresolvedReferences },
    duplicateIds: parse.duplicateIds,
    malformedLines: { count: parse.malformed.length, list: parse.malformed.slice(0, 1000) },
    blankLines: parse.blankLines,
    totalLines: parse.totalLines,
    warnings,
    errors: v.errors,
    checks: v.checks,
    maxParts: {
      people: Math.max(v.maxParts.people.metadata, v.maxParts.people.raw),
      facts: Math.max(v.maxParts.facts.metadata, v.maxParts.facts.raw),
      relationships: Math.max(v.maxParts.relationships.metadata, v.maxParts.relationships.raw),
    },
    xmlSubstitutions: 0,
    shortenedDisplayCells: shortened,
    durationsMs: durations,
    generatedAt: new Date().toISOString(),
  };

  if (v.errors.length > 0) {
    durations.total = now() - t0;
    return { ok: false, errors: v.errors, summary, report: renderReport(summary) };
  }

  progress('writing', 0);
  const mp = v.maxParts;
  const written = await writeWorkbook(
    [
      sheetSpec(rows.people, mp.people.metadata, mp.people.raw),
      sheetSpec(rows.facts, mp.facts.metadata, mp.facts.raw),
      sheetSpec(rows.relationships, mp.relationships.metadata, mp.relationships.raw),
    ],
    (done, total) => progress('writing', done / total),
  );
  lap('write');
  summary.xmlSubstitutions = written.xmlSubstitutions;
  if (written.xmlSubstitutions > 0)
    summary.warnings.push(
      `Characters that Excel cannot store directly were written in Excel's _xHHHH_ form: ${written.xmlSubstitutions}.`,
    );
  durations.total = now() - t0;
  progress('writing', 1);
  return { ok: true, workbook: written.bytes, summary, report: renderReport(summary) };
}
