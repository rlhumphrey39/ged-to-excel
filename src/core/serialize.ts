import type { GedcomNode, MalformedLine } from './types';

/** Maximum UTF-16 code units per cell part (Excel's hard limit is 32,767). */
export const SAFE_CELL = 30000;

export interface PlainNode {
  line: number;
  level: number;
  tag: string;
  id?: string;
  value?: string;
  children?: PlainNode[];
}

/** Plain object with keys in the fixed order line, level, tag, id, value, children. */
export function toPlain(node: GedcomNode): PlainNode {
  const o: PlainNode = { line: node.line, level: node.level, tag: node.tag };
  if (node.xref !== undefined) o.id = node.xref;
  if (node.value !== '') o.value = node.value;
  if (node.children.length > 0) o.children = node.children.map(toPlain);
  return o;
}

/** Lossless JSON for a node subtree (All metadata). */
export function toJson(node: GedcomNode): string {
  return JSON.stringify(toPlain(node));
}

/** All metadata for a malformed line. */
export function malformedJson(m: MalformedLine): string {
  return JSON.stringify({ line: m.line, raw: m.raw, problem: m.reason });
}

/** Raw GEDCOM text of a subtree: original lines, depth-first, joined with "\n". */
export function rawText(node: GedcomNode): string {
  const out: string[] = [];
  const walk = (n: GedcomNode) => {
    out.push(n.raw);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out.join('\n');
}

/** Visit every node of a subtree depth-first. */
export function walkTree(node: GedcomNode, fn: (n: GedcomNode) => void): void {
  fn(node);
  for (const c of node.children) walkTree(c, fn);
}

/**
 * Rebuild the raw lines from a JSON subtree (used by tests to prove the JSON is lossless).
 * Only valid for lines without leading whitespace and with single delimiters, which is what
 * the parser's grammar produces from well-formed input.
 */
export function plainToRaw(p: PlainNode): string {
  const lines: string[] = [];
  const walk = (n: PlainNode) => {
    let s = String(n.level);
    if (n.id !== undefined) s += ' ' + n.id;
    s += ' ' + n.tag;
    if (n.value !== undefined) s += ' ' + n.value;
    lines.push(s);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p);
  return lines.join('\n');
}

/** Split a string into parts of at most SAFE_CELL code units without separating surrogate pairs. */
export function splitCell(s: string, size: number = SAFE_CELL): string[] {
  if (s.length <= size) return [s];
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + size, s.length);
    if (end < s.length) {
      const prev = s.charCodeAt(end - 1);
      const next = s.charCodeAt(end);
      if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    }
    parts.push(s.slice(i, end));
    i = end;
  }
  if (parts.join('') !== s) throw new Error('splitCell: parts do not rejoin to the original text');
  return parts;
}

/** Number of parts splitCell would produce, without allocating them. */
export function partCount(s: string, size: number = SAFE_CELL): number {
  if (s.length <= size) return 1;
  let n = 0;
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + size, s.length);
    if (end < s.length) {
      const prev = s.charCodeAt(end - 1);
      const next = s.charCodeAt(end);
      if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    }
    n++;
    i = end;
  }
  return n;
}
