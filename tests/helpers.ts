import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeGedcom } from '../src/core/encoding';
import { parseGedcom } from '../src/core/parser';
import { buildRows } from '../src/core/rows';
import type { BuiltRows, ParseResult } from '../src/core/types';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export function parseFixture(name: string): { text: string; parse: ParseResult } {
  const d = decodeGedcom(fixtureBytes(name));
  return { text: d.text, parse: parseGedcom(d.text, { declaredCharset: d.declaredCharset, usedEncoding: d.usedEncoding }) };
}

export function rowsFor(name: string): { text: string; parse: ParseResult; rows: BuiltRows } {
  const p = parseFixture(name);
  return { ...p, rows: buildRows(p.parse) };
}

export const bytes = (...parts: (string | number[])[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of Buffer.from(p, 'latin1')) out.push(ch);
    else out.push(...p);
  }
  return new Uint8Array(out);
};
