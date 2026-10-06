/**
 * Manual acceptance run (not part of the test suite; never commit real family trees).
 *
 *   npm run acceptance -- /path/to/your.ged [out.xlsx]
 *
 * Runs the same convert() pipeline the browser worker uses, prints counts, validation checks, stage
 * timings and peak memory, writes the workbook and the text report (default: the system temp directory),
 * then reads the workbook back with exceljs (streaming) and prints sheet names and row counts.
 * Only counts and technical details are printed; no names, dates, places or raw lines.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
import { convert } from '../src/core/convert';
import type { Stage } from '../src/core/types';

const fmt = (n: number) => n.toLocaleString('en-US');
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
// process.resourceUsage().maxRSS is reported in kilobytes.
const peakRss = () => process.resourceUsage().maxRSS * 1024;

async function main() {
  const [gedPath, outArg] = process.argv.slice(2);
  if (!gedPath) {
    console.error('Usage: npm run acceptance -- <file.ged> [out.xlsx]');
    process.exit(2);
  }
  const base = basename(gedPath).replace(/\.[^.]+$/, '');
  const outPath = resolve(outArg ?? join(tmpdir(), `${base}-for-ChatGPT.xlsx`));
  const reportPath = outPath.replace(/\.xlsx$/i, '') + '-conversion-report.txt';
  mkdirSync(dirname(outPath), { recursive: true });

  const t0 = performance.now();
  const bytes = new Uint8Array(readFileSync(gedPath));
  const tRead = performance.now() - t0;
  console.log(`Input: ${fmt(bytes.length)} bytes (read in ${Math.round(tRead)} ms)`);

  let lastStage: Stage | '' = '';
  const result = await convert({ name: basename(gedPath), bytes }, {}, (p) => {
    if (p.stage !== lastStage) {
      lastStage = p.stage;
      console.log(`  stage: ${p.stage} (${p.percent}%)`);
    }
  });
  const convertPeak = peakRss();
  const s = result.summary;

  console.log('\n== Summary ==');
  console.log(`GEDCOM version: ${s.gedcomVersion || '(none)'}; declared charset: ${s.declaredCharset || '(none)'}; used: ${s.usedEncoding}`);
  console.log(`Source program present: ${s.sourceProgram ? 'yes' : 'no'}`);
  console.log(`SHA-256: ${s.sha256}`);
  console.log(`Total lines: ${fmt(s.totalLines)} (blank ${fmt(s.blankLines)})`);
  console.log(`People rows: ${fmt(s.people)}`);
  console.log(`Families (FAM records): ${fmt(s.families)}; families represented in Relationships: ${fmt(s.familiesInRelationships)}`);
  console.log(`Facts rows: ${fmt(s.factRows)}`);
  console.log(`Relationships rows: ${fmt(s.relationshipRows)} (placeholders ${fmt(s.placeholderRows)})`);
  console.log(`Other records: ${fmt(s.otherRecords)} ${JSON.stringify(s.otherRecordsByTag)}`);
  console.log(`Unresolved references: ${fmt(s.unresolvedReferences.count)}`);
  console.log(`Duplicate IDs: ${fmt(s.duplicateIds.length)}`);
  console.log(`Malformed lines: ${fmt(s.malformedLines.count)}`);
  console.log(`Max continuation parts: People ${s.maxParts.people}, Facts ${s.maxParts.facts}, Relationships ${s.maxParts.relationships}`);
  console.log(`XML substitutions: ${s.xmlSubstitutions}; shortened display cells: ${s.shortenedDisplayCells}`);

  console.log('\n== Validation checks ==');
  for (const c of s.checks) console.log(`${c.status}  ${c.name}: ${c.detail}`);
  console.log('\n== Warnings ==');
  if (s.warnings.length === 0) console.log('(none)');
  for (const w of s.warnings) console.log(`- ${w}`);

  console.log('\n== Stage timings (ms) ==');
  for (const [k, v] of Object.entries(s.durationsMs)) console.log(`${k.padEnd(9)} ${Math.round(v)}`);
  console.log(`Peak RSS during conversion: ${mb(convertPeak)}`);

  writeFileSync(reportPath, result.report);
  console.log(`\nReport written: ${reportPath}`);
  if (!result.ok) {
    console.log('\nRESULT: FAILED validation; no workbook produced.');
    for (const e of result.errors) console.log(`ERROR: ${e}`);
    process.exit(1);
  }
  writeFileSync(outPath, result.workbook);
  console.log(`Workbook written: ${outPath} (${mb(result.workbook.length)})`);

  // Read back with exceljs (independent implementation), streaming to keep memory bounded.
  const tBack = performance.now();
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(outPath, {
    sharedStrings: 'ignore', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit', entries: 'emit',
  });
  const sheets: { name: string; rows: number; families?: number; headers: number }[] = [];
  for await (const ws of reader) {
    const w = ws as unknown as { name: string } & AsyncIterable<ExcelJS.Row>;
    let rows = 0;
    let headers = 0;
    const fams = new Set<string>();
    for await (const row of w) {
      if (row.number === 1) {
        headers = row.cellCount;
        continue;
      }
      rows++;
      const v = (row.values as unknown[])[2];
      if (typeof v === 'string') fams.add(v);
    }
    sheets.push({ name: w.name, rows, headers, families: fams.size });
  }
  console.log('\n== Read back with exceljs ==');
  for (const sh of sheets)
    console.log(`${sh.name}: ${fmt(sh.rows)} data rows, ${sh.headers} columns` + (sh.name === 'Relationships' ? `, ${fmt(sh.families!)} distinct Family IDs` : ''));
  console.log(`Read-back time: ${Math.round(performance.now() - tBack)} ms`);
  const names = sheets.map((x) => x.name).join(',');
  const okBack =
    names === 'People,Facts,Relationships' &&
    sheets[0]!.rows === s.people &&
    sheets[1]!.rows === s.factRows &&
    sheets[2]!.rows === s.relationshipRows;
  console.log(`Read-back matches summary: ${okBack ? 'yes' : 'NO'}`);
  console.log(`Peak RSS overall: ${mb(peakRss())}`);
  console.log(`Total wall time: ${Math.round(performance.now() - t0)} ms`);
  console.log(`\nRESULT: ${okBack ? 'OK' : 'MISMATCH'}`);
  if (!okBack) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exit(1);
});
