import { describe, expect, it } from 'vitest';
import { parseGedcom, resolvedValue } from '../src/core/parser';
import { parseFixture } from './helpers';

describe('parser', () => {
  it('builds an ordered tree with line numbers and raw lines', () => {
    const { parse } = parseFixture('basic.ged');
    expect(parse.records[0]!.tag).toBe('HEAD');
    expect(parse.records.at(-1)!.tag).toBe('TRLR');
    expect(parse.indiCount).toBe(6);
    expect(parse.famCount).toBe(3);
    const i1 = parse.xrefIndex.get('@I1@')![0]!;
    expect(i1.level).toBe(0);
    expect(i1.raw).toBe('0 @I1@ INDI');
    expect(i1.children[0]!.tag).toBe('NAME');
    expect(i1.children[0]!.value).toBe('Alice /Example/');
    expect(i1.children[0]!.line).toBe(i1.line + 1);
    expect(i1.children[0]!.children.map((c) => c.tag)).toEqual(['GIVN', 'SURN']);
    const births = i1.children.filter((c) => c.tag === 'BIRT');
    expect(births.length).toBe(2);
    expect(parse.version).toBe('5.5.1');
    expect(parse.sourceProgram).toBe('Family Tree Maker for Windows, version 24.0');
    expect(parse.malformed).toEqual([]);
    expect(parse.duplicateIds).toEqual([]);
    expect(parse.warnings).toEqual([]);
  });

  it('keeps extra spaces in values (lossless)', () => {
    const { parse } = parseFixture('basic.ged');
    const i1 = parse.xrefIndex.get('@I1@')![0]!;
    const note = i1.children.find((c) => c.tag === 'NOTE')!;
    expect(note.value).toBe('  Leading spaces note');
    expect(note.raw).toBe('1 NOTE   Leading spaces note');
  });

  it('keeps CONT/CONC as nodes and resolves them for display', () => {
    const { parse } = parseFixture('basic.ged');
    const n1 = parse.xrefIndex.get('@N1@')![0]!;
    expect(n1.children.map((c) => c.tag)).toEqual(['CONC', 'CONT']);
    expect(resolvedValue(n1)).toBe('This is a long note that is split across lines\nand continues on a new line.');
  });

  it('indexes duplicate IDs and keeps both records', () => {
    const { parse } = parseFixture('duplicates.ged');
    expect(parse.xrefIndex.get('@I1@')!.length).toBe(2);
    expect(parse.xrefIndex.get('@F1@')!.length).toBe(2);
    expect(parse.duplicateIds).toEqual(['@I1@', '@F1@']);
    expect(parse.indiCount).toBe(2);
    expect(parse.warnings.join('\n')).toMatch(/Duplicate record IDs/);
  });

  it('captures malformed lines with reasons, blank lines, and leading whitespace', () => {
    const { parse } = parseFixture('malformed.ged');
    const byLine = Object.fromEntries(parse.malformed.map((m) => [m.line, m.reason]));
    expect(byLine).toEqual({
      1: 'Non-zero level before the first record',
      8: 'Does not match level/tag structure',
      10: 'Level 3 is deeper than parent level 1 + 1',
      11: 'Parent line 10 was malformed',
      15: 'Level-0 line without a tag',
      16: 'Parent line 15 was malformed',
    });
    expect(parse.malformed.find((m) => m.line === 8)!.raw).toBe('NAME Bob');
    expect(parse.blankLines).toBe(1);
    expect(parse.blankLineNumbers).toEqual([14]);
    expect(parse.totalLines).toBe(19);
    expect(parse.warnings).toContain('Lines with leading whitespace were accepted: 1');
    const i1 = parse.xrefIndex.get('@I1@')![0]!;
    expect(i1.children.map((c) => c.tag)).toEqual(['NAME', 'BIRT', 'SEX', 'OCCU']);
    // CRLF stripped from raw
    expect(i1.children[0]!.raw).toBe('1 NAME Bob /Sample/');
    expect(i1.children[3]!.raw).toBe('   1 OCCU Farmer');
    expect(parse.records.map((r) => r.tag)).toEqual(['HEAD', 'INDI', 'INDI', 'TRLR']);
    expect(parse.warnings.join('\n')).toMatch(/HEAD record starts on line 2/);
  });

  it('warns about a missing TRLR and records after TRLR', () => {
    expect(parseFixture('no-trlr.ged').parse.warnings.join('\n')).toMatch(/No TRLR/);
    const p = parseGedcom('0 HEAD\n0 TRLR\n0 @I1@ INDI\n');
    expect(p.warnings.join('\n')).toMatch(/TRLR is not the last record: 1 record/);
    const q = parseGedcom('0 @I1@ INDI\n');
    expect(q.warnings.join('\n')).toMatch(/No HEAD record/);
  });

  it('handles values with odd characters and counts physical lines', () => {
    const p = parseGedcom('0 HEAD\n1 NOTE a b\r\n1 NAME\n0 TRLR');
    expect(p.totalLines).toBe(4);
    expect(p.records[0]!.children[0]!.value).toBe('a b');
    expect(p.records[0]!.children[1]!.value).toBe('');
    expect(parseGedcom('0 HEAD\n0 TRLR\n').totalLines).toBe(2);
  });

  it('reports progress', () => {
    const lines = ['0 HEAD'];
    for (let i = 0; i < 12000; i++) lines.push(`0 @I${i}@ INDI`);
    const calls: number[] = [];
    parseGedcom(lines.join('\n'), { onProgress: (_f, n) => calls.push(n) });
    expect(calls).toEqual([5000, 10000, 12001]);
  });
});
