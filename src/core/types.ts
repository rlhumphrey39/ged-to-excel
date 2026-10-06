/** One GEDCOM line with its ordered children. Nothing is dropped or normalised. */
export interface GedcomNode {
  /** 1-based physical source line number. */
  line: number;
  level: number;
  /** Level-0 record ID as written, including the @ signs, e.g. "@I5@". */
  xref?: string;
  /** Tag, e.g. "INDI", "NAME", "_PHOTO". */
  tag: string;
  /** Text after the tag; "" when absent. Pointers such as "@F1@" stay as text. */
  value: string;
  /** Original line without CR/LF (BOM removed from line 1). */
  raw: string;
  children: GedcomNode[];
}

export interface MalformedLine {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  records: GedcomNode[];
  malformed: MalformedLine[];
  blankLines: number;
  /** Line numbers of blank (empty or whitespace-only) lines. */
  blankLineNumbers: number[];
  /** Physical lines (a final empty segment after the last newline is not a line). */
  totalLines: number;
  xrefIndex: Map<string, GedcomNode[]>;
  duplicateIds: string[];
  warnings: string[];
  version: string;
  sourceProgram: string;
  declaredCharset: string;
  usedEncoding: string;
  indiCount: number;
  famCount: number;
}

export interface DecodeResult {
  text: string;
  usedEncoding: string;
  declaredCharset: string;
  warnings: string[];
}

export type CellValue = string | number | null;

export type SheetName = 'People' | 'Facts' | 'Relationships';

export interface ColumnDef {
  header: string;
  width: number;
  wrap: boolean;
  /** Number columns get the numeric style. */
  numeric?: boolean;
}

/**
 * One workbook row before serialisation. Display cells are computed up front; the lossless JSON and
 * raw GEDCOM are produced on demand from `node` (or `malformed`) so large strings are never all held at once.
 */
export interface RowDesc {
  cells: CellValue[];
  /** Subtree serialised into All metadata / Raw GEDCOM. */
  node?: GedcomNode;
  /** Set for Facts rows that represent a malformed line. */
  malformed?: MalformedLine;
  /** Record that owns this row (INDI for People/Facts, FAM for Facts/Relationships, the record itself for standalone). */
  owner?: GedcomNode;
  /** True for the Relationships placeholder row of a family with no links. */
  placeholder?: boolean;
  /** Number of display cells shortened to fit one Excel cell (full text stays in the continuation columns). */
  shortenedCells?: number;
}

export interface SheetRows {
  name: SheetName;
  columns: ColumnDef[];
  rows: RowDesc[];
}

export interface BuiltRows {
  people: SheetRows;
  facts: SheetRows;
  relationships: SheetRows;
}

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ValidationCheck {
  name: string;
  ok: boolean;
  status: CheckStatus;
  detail: string;
}

export interface UnresolvedReference {
  line: number;
  tag: string;
  target: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  checks: ValidationCheck[];
  unresolvedReferences: UnresolvedReference[];
  unresolvedCount: number;
  maxParts: {
    people: { metadata: number; raw: number };
    facts: { metadata: number; raw: number };
    relationships: { metadata: number; raw: number };
  };
  customTagsRetained: number;
  unknownTagsRetained: number;
  independentCounts: { indi: number; fam: number };
}

export type Stage = 'reading' | 'parsing' | 'checking' | 'writing';

export interface ProgressEvent {
  stage: Stage;
  /** Overall percent 0..100. */
  percent: number;
}

export interface ConversionSummary {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  gedcomVersion: string;
  declaredCharset: string;
  usedEncoding: string;
  sourceProgram: string;
  people: number;
  families: number;
  otherRecords: number;
  otherRecordsByTag: Record<string, number>;
  factRows: number;
  relationshipRows: number;
  placeholderRows: number;
  familiesInRelationships: number;
  unresolvedReferences: { count: number; list: UnresolvedReference[] };
  duplicateIds: string[];
  malformedLines: { count: number; list: MalformedLine[] };
  blankLines: number;
  totalLines: number;
  warnings: string[];
  errors: string[];
  checks: ValidationCheck[];
  maxParts: { people: number; facts: number; relationships: number };
  xmlSubstitutions: number;
  shortenedDisplayCells: number;
  durationsMs: Record<string, number>;
  generatedAt: string;
}

export type ConvertResult =
  | { ok: true; workbook: Uint8Array; summary: ConversionSummary; report: string }
  | { ok: false; errors: string[]; summary: ConversionSummary; report: string };
