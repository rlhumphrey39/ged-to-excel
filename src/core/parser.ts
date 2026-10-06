import type { GedcomNode, MalformedLine, ParseResult } from './types';

const LINE_RE = /^(\d{1,2})\s(?:(@[^@\s]+@)\s)?([A-Za-z0-9_]+)(?:\s(.*))?$/s;
const LEVEL0_NO_TAG_RE = /^0(?:\s+@[^@\s]+@)?\s*$/;
const LEVEL_ONLY_RE = /^(\d{1,2})(?:\s|$)/;

export interface ParseOptions {
  declaredCharset?: string;
  usedEncoding?: string;
  /** Called with (linesDone, approxTotalChars progress 0..1) every 5,000 lines. */
  onProgress?: (fraction: number, linesDone: number) => void;
}

/** CONT/CONC-resolved value of a node (for display columns only; the tree keeps CONT/CONC as nodes). */
export function resolvedValue(node: GedcomNode): string {
  let v = node.value;
  for (const c of node.children) {
    if (c.tag === 'CONT') v += '\n' + c.value;
    else if (c.tag === 'CONC') v += c.value;
  }
  return v;
}

export function firstChild(node: GedcomNode, tag: string): GedcomNode | undefined {
  for (const c of node.children) if (c.tag === tag) return c;
  return undefined;
}

/** Parse decoded GEDCOM text into an ordered, lossless tree. */
export function parseGedcom(text: string, opts: ParseOptions = {}): ParseResult {
  const records: GedcomNode[] = [];
  const malformed: MalformedLine[] = [];
  const blankLineNumbers: number[] = [];
  const xrefIndex = new Map<string, GedcomNode[]>();
  const duplicateSet = new Set<string>();
  const duplicateIds: string[] = [];
  const warnings: string[] = [];
  let leadingWhitespace = 0;

  // stack[i] = currently open node at level i
  const stack: GedcomNode[] = [];
  // When a line is malformed but has a level, lines deeper than it are its would-be children.
  let badParentLevel = -1;
  let badParentLine = 0;

  const len = text.length;
  let pos = 0;
  let lineNo = 0;
  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let raw = text.slice(pos, nl);
    pos = nl + 1;
    lineNo++;
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (lineNo === 1 && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    if (lineNo % 5000 === 0 && opts.onProgress) opts.onProgress(pos / len, lineNo);

    if (raw.trim() === '') {
      blankLineNumbers.push(lineNo);
      continue;
    }

    let body = raw;
    let trimmed = false;
    if (/^\s/.test(body)) {
      body = body.replace(/^\s+/, '');
      trimmed = true;
    }

    const m = LINE_RE.exec(body);
    if (!m) {
      let reason = 'Does not match level/tag structure';
      if (LEVEL0_NO_TAG_RE.test(body)) reason = 'Level-0 line without a tag';
      const lm = LEVEL_ONLY_RE.exec(body);
      const level = lm ? parseInt(lm[1]!, 10) : -1;
      if (badParentLevel >= 0 && level > badParentLevel) {
        reason = `Parent line ${badParentLine} was malformed`;
      } else if (level >= 0) {
        badParentLevel = level;
        badParentLine = lineNo;
        if (level === 0) stack.length = 0;
      }
      malformed.push({ line: lineNo, raw, reason });
      continue;
    }
    if (trimmed) leadingWhitespace++;

    const level = parseInt(m[1]!, 10);
    const node: GedcomNode = {
      line: lineNo,
      level,
      tag: m[3]!,
      value: m[4] ?? '',
      raw,
      children: [],
    };
    if (m[2]) node.xref = m[2];

    if (badParentLevel >= 0) {
      if (level > badParentLevel) {
        malformed.push({ line: lineNo, raw, reason: `Parent line ${badParentLine} was malformed` });
        continue;
      }
      badParentLevel = -1;
    }

    if (level === 0) {
      stack.length = 0;
      stack.push(node);
      records.push(node);
      if (node.xref) {
        const list = xrefIndex.get(node.xref);
        if (list) {
          list.push(node);
          if (!duplicateSet.has(node.xref)) {
            duplicateSet.add(node.xref);
            duplicateIds.push(node.xref);
          }
        } else xrefIndex.set(node.xref, [node]);
      }
      continue;
    }

    if (stack.length === 0) {
      malformed.push({ line: lineNo, raw, reason: 'Non-zero level before the first record' });
      badParentLevel = level;
      badParentLine = lineNo;
      continue;
    }
    const depth = stack.length - 1;
    if (level > depth + 1) {
      malformed.push({ line: lineNo, raw, reason: `Level ${level} is deeper than parent level ${depth} + 1` });
      badParentLevel = level;
      badParentLine = lineNo;
      continue;
    }
    const parent = stack[level - 1]!;
    parent.children.push(node);
    stack.length = level;
    stack.push(node);
  }

  // Version and source program from HEAD
  let version = '';
  let sourceProgram = '';
  const head = records.find((r) => r.tag === 'HEAD');
  if (head) {
    const gedc = firstChild(head, 'GEDC');
    const vers = gedc && firstChild(gedc, 'VERS');
    if (vers) version = vers.value;
    const sour = firstChild(head, 'SOUR');
    if (sour) {
      const name = firstChild(sour, 'NAME')?.value || sour.value;
      const sv = firstChild(sour, 'VERS')?.value;
      sourceProgram = [name, sv ? `version ${sv}` : ''].filter(Boolean).join(', ');
    }
  }

  // Warnings
  if (records.length === 0 || records[0]!.tag !== 'HEAD') warnings.push('No HEAD record at the start of the file.');
  else if (records[0]!.line !== 1) warnings.push(`The HEAD record starts on line ${records[0]!.line}, not line 1.`);
  const trlrIdx = records.findIndex((r) => r.tag === 'TRLR');
  if (trlrIdx === -1) warnings.push('No TRLR (end of file) record; the file may be cut short.');
  else if (trlrIdx !== records.length - 1)
    warnings.push(`TRLR is not the last record: ${records.length - 1 - trlrIdx} record(s) come after it (all kept).`);
  if (leadingWhitespace > 0) warnings.push(`Lines with leading whitespace were accepted: ${leadingWhitespace}`);
  if (malformed.length > 0)
    warnings.push(`Malformed lines kept as rows in the Facts sheet: ${malformed.length}`);
  if (duplicateIds.length > 0)
    warnings.push(`Duplicate record IDs (all records kept): ${duplicateIds.length}`);

  let indiCount = 0;
  let famCount = 0;
  for (const r of records) {
    if (r.tag === 'INDI') indiCount++;
    else if (r.tag === 'FAM') famCount++;
  }

  if (opts.onProgress) opts.onProgress(1, lineNo);

  return {
    records,
    malformed,
    blankLines: blankLineNumbers.length,
    blankLineNumbers,
    totalLines: lineNo,
    xrefIndex,
    duplicateIds,
    warnings,
    version,
    sourceProgram,
    declaredCharset: opts.declaredCharset ?? '',
    usedEncoding: opts.usedEncoding ?? '',
    indiCount,
    famCount,
  };
}
