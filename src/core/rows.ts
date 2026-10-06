import type { BuiltRows, ColumnDef, GedcomNode, ParseResult, RowDesc, SheetRows } from './types';
import { firstChild, resolvedValue } from './parser';
import { splitName, surnameFirst } from './names';
import { factLabel, recordLabel } from './labels';
import { SAFE_CELL, malformedJson, rawText, toJson, walkTree } from './serialize';

const col = (header: string, width: number, wrap: boolean, numeric = false): ColumnDef =>
  numeric ? { header, width, wrap, numeric } : { header, width, wrap };

export const PEOPLE_COLUMNS: ColumnDef[] = [
  col('Person ID', 12, false),
  col('Name (surname first)', 28, true),
  col('Primary name', 28, true),
  col('Surname', 20, true),
  col('Given names', 20, true),
  col('Suffix', 8, true),
  col('Recorded sex', 8, false),
  col('All names', 36, true),
  col('Name count', 8, false),
  col('Private', 9, false),
  col('Restriction', 14, true),
  col('Source line', 11, false, true),
];

export const FACTS_COLUMNS: ColumnDef[] = [
  col('Fact ID', 12, false),
  col('Owner type', 16, false),
  col('Owner ID', 12, false),
  col('Record type', 12, false),
  col('Tag', 12, false),
  col('Fact type', 22, true),
  col('Type detail', 18, true),
  col('Value', 40, true),
  col('Date', 18, true),
  col('Place', 32, true),
  col('Private', 9, false),
  col('Restriction', 14, true),
  col('Owner restriction', 14, true),
  col('Source line', 11, false, true),
];

export const RELATIONSHIP_COLUMNS: ColumnDef[] = [
  col('Relationship ID', 12, false),
  col('Family ID', 12, false),
  col('Role', 16, false),
  col('Original tag', 12, false),
  col('Person ID', 12, false),
  col('Private', 9, false),
  col('Restriction', 14, true),
  col('Family restriction', 14, true),
  col('Source line', 11, false, true),
];

/** Continuation columns: always numbered, even when there is only one part. */
export function metadataColumns(metaParts: number, rawParts: number): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (let i = 1; i <= Math.max(1, metaParts); i++) out.push(col(`All metadata ${i}`, 60, false));
  for (let i = 1; i <= Math.max(1, rawParts); i++) out.push(col(`Raw GEDCOM ${i}`, 60, false));
  return out;
}

const PEOPLE_EXCLUDED = new Set(['NAME', 'SEX', 'RESN']);
const FAMILY_LINKS = new Set(['HUSB', 'WIFE', 'CHIL']);
const ROLE: Record<string, string> = { HUSB: 'Spouse 1', WIFE: 'Spouse 2', CHIL: 'Child' };
export const PLACEHOLDER_ROLE = 'No recorded relationship links';

/** Values of a record's level-1 RESN nodes, joined by " | ". */
export function recordRestriction(record: GedcomNode): string {
  const vals: string[] = [];
  for (const c of record.children) if (c.tag === 'RESN') vals.push(c.value);
  return vals.join(' | ');
}

/** All RESN values anywhere inside a subtree (depth-first, including the node itself), joined by " | ". */
export function subtreeRestriction(node: GedcomNode): string {
  const vals: string[] = [];
  walkTree(node, (n) => {
    if (n.tag === 'RESN') vals.push(n.value);
  });
  return vals.join(' | ');
}

/** True if any " | "-separated restriction value equals "privacy" (case-insensitive, trimmed). */
export function hasPrivacy(...restrictions: string[]): boolean {
  for (const r of restrictions) {
    if (!r) continue;
    for (const v of r.split(' | ')) if (v.trim().toLowerCase() === 'privacy') return true;
  }
  return false;
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const blank = (s: string | undefined): string | null => (s === undefined || s === '' ? null : s);

export const SHORTENED_NOTE = ' [… shortened here; the full text is in the All metadata and Raw GEDCOM columns]';

/**
 * Display columns must fit in one Excel cell. A display value longer than SAFE_CELL is shortened with a
 * clear note; the complete text is always in the All metadata / Raw GEDCOM continuation columns.
 */
function fit(cells: (string | number | null)[]): { cells: (string | number | null)[]; shortened: number } {
  let shortened = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (typeof c === 'string' && c.length > SAFE_CELL) {
      let cut = SAFE_CELL - SHORTENED_NOTE.length;
      const code = c.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut--;
      cells[i] = c.slice(0, cut) + SHORTENED_NOTE;
      shortened++;
    }
  }
  return { cells, shortened };
}

function makeRow(cells: (string | number | null)[], rest: Omit<RowDesc, 'cells'>): RowDesc {
  const f = fit(cells);
  const row: RowDesc = { cells: f.cells, ...rest };
  if (f.shortened) row.shortenedCells = f.shortened;
  return row;
}

export function recordId(record: GedcomNode): string {
  return record.xref ?? `${record.tag}:L${record.line}`;
}

export function pad6(n: number): string {
  return String(n).padStart(6, '0');
}

export function buildPeople(parse: ParseResult): SheetRows {
  const rows: RowDesc[] = [];
  for (const rec of parse.records) {
    if (rec.tag !== 'INDI') continue;
    const names = rec.children.filter((c) => c.tag === 'NAME');
    const first = names[0];
    const primary = first ? resolvedValue(first) : '';
    const parts = first ? splitName(primary, first) : { given: '', surname: '', suffix: '' };
    const sex = firstChild(rec, 'SEX');
    const restriction = recordRestriction(rec);
    rows.push(makeRow(
      [
        rec.xref ?? `INDI:L${rec.line}`,
        blank(first ? surnameFirst(parts) : ''),
        blank(primary),
        blank(parts.surname),
        blank(parts.given),
        blank(parts.suffix),
        blank(sex?.value),
        blank(names.map(resolvedValue).join(' | ')),
        String(names.length),
        yesNo(hasPrivacy(restriction)),
        blank(restriction),
        rec.line,
      ],
      { node: rec, owner: rec },
    ));
  }
  return { name: 'People', columns: PEOPLE_COLUMNS, rows };
}

function factCells(
  id: number,
  ownerType: string,
  ownerId: string,
  recordType: string,
  node: GedcomNode,
  factType: string,
  ownerRestriction: string,
): (string | number | null)[] {
  const restriction = subtreeRestriction(node);
  return [
    `FACT-${pad6(id)}`,
    ownerType,
    ownerId,
    recordType,
    node.tag,
    factType,
    blank(firstChild(node, 'TYPE')?.value),
    blank(resolvedValue(node)),
    blank(firstChild(node, 'DATE')?.value),
    blank(firstChild(node, 'PLAC')?.value),
    yesNo(hasPrivacy(restriction, ownerRestriction)),
    blank(restriction),
    blank(ownerRestriction),
    node.line,
  ];
}

export function buildFacts(parse: ParseResult): SheetRows {
  const rows: RowDesc[] = [];
  let n = 0;
  for (const rec of parse.records) {
    if (rec.tag === 'INDI' || rec.tag === 'FAM') {
      const isIndi = rec.tag === 'INDI';
      const ownerType = isIndi ? 'Person' : 'Family';
      const ownerId = recordId(rec);
      const ownerRestriction = recordRestriction(rec);
      for (const c of rec.children) {
        // People: NAME/SEX/RESN live in the People row. Families: HUSB/WIFE/CHIL live in Relationships.
        // A family's own RESN is kept here (it would otherwise appear in no row's metadata).
        if (isIndi ? PEOPLE_EXCLUDED.has(c.tag) : FAMILY_LINKS.has(c.tag)) continue;
        rows.push(makeRow(
          factCells(++n, ownerType, ownerId, rec.tag, c, factLabel(c.tag), ownerRestriction),
          { node: c, owner: rec },
        ));
      }
    } else {
      rows.push(makeRow(
        factCells(++n, 'Standalone record', recordId(rec), rec.tag, rec, recordLabel(rec.tag), ''),
        { node: rec, owner: rec },
      ));
      // Owner restriction is blank for standalone rows (the record's own RESN is in Restriction).
    }
  }
  for (const m of parse.malformed) {
    rows.push(makeRow(
      [
        `FACT-${pad6(++n)}`,
        'Malformed line',
        `LINE:${m.line}`,
        null,
        null,
        'Malformed or unparsed line',
        null,
        blank(m.raw),
        null,
        null,
        'No',
        null,
        null,
        m.line,
      ],
      { malformed: m },
    ));
  }
  return { name: 'Facts', columns: FACTS_COLUMNS, rows };
}

export function buildRelationships(parse: ParseResult): SheetRows {
  const rows: RowDesc[] = [];
  let n = 0;
  for (const rec of parse.records) {
    if (rec.tag !== 'FAM') continue;
    const famId = recordId(rec);
    const famRestriction = recordRestriction(rec);
    let any = false;
    for (const c of rec.children) {
      if (!FAMILY_LINKS.has(c.tag)) continue;
      any = true;
      const restriction = subtreeRestriction(c);
      rows.push(makeRow(
        [
          `REL-${pad6(++n)}`,
          famId,
          ROLE[c.tag]!,
          c.tag,
          blank(c.value),
          yesNo(hasPrivacy(restriction, famRestriction)),
          blank(restriction),
          blank(famRestriction),
          c.line,
        ],
        { node: c, owner: rec },
      ));
    }
    if (!any) {
      rows.push(makeRow(
        [
          `REL-${pad6(++n)}`,
          famId,
          PLACEHOLDER_ROLE,
          null,
          null,
          yesNo(hasPrivacy(famRestriction)),
          null,
          blank(famRestriction),
          rec.line,
        ],
        { node: rec, owner: rec, placeholder: true },
      ));
    }
  }
  return { name: 'Relationships', columns: RELATIONSHIP_COLUMNS, rows };
}

export function buildRows(parse: ParseResult): BuiltRows {
  return { people: buildPeople(parse), facts: buildFacts(parse), relationships: buildRelationships(parse) };
}

/** All metadata text for a row (lossless JSON). */
export function rowJson(row: RowDesc): string {
  if (row.malformed) return malformedJson(row.malformed);
  return row.node ? toJson(row.node) : '';
}

/** Raw GEDCOM text for a row. */
export function rowRaw(row: RowDesc): string {
  if (row.malformed) return row.malformed.raw;
  return row.node ? rawText(row.node) : '';
}
