import { describe, expect, it } from 'vitest';
import { convert } from '../src/core/convert';
import { sha256Hex, sha256Js } from '../src/core/sha256';
import { CHATGPT_PROMPT } from '../src/core/prompt';
import { fixtureBytes, bytes } from './helpers';
import type { ProgressEvent } from '../src/core/types';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('convert', () => {
  it('converts basic.ged end to end with a full summary', async () => {
    const progress: ProgressEvent[] = [];
    const r = await convert({ name: 'basic.ged', bytes: fixtureBytes('basic.ged') }, {}, (p) => progress.push(p));
    expect(r.ok).toBe(true);
    const s = r.summary;
    expect(s).toMatchObject({
      fileName: 'basic.ged',
      gedcomVersion: '5.5.1',
      declaredCharset: 'UTF-8',
      usedEncoding: 'UTF-8',
      people: 6,
      families: 3,
      otherRecords: 9,
      factRows: 42,
      relationshipRows: 6,
      placeholderRows: 1,
      familiesInRelationships: 3,
      blankLines: 0,
      xmlSubstitutions: 0,
    });
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.otherRecordsByTag).toEqual({ HEAD: 1, SUBM: 1, SOUR: 2, REPO: 1, OBJE: 2, NOTE: 1, TRLR: 1 });
    expect(s.unresolvedReferences.count).toBe(2);
    expect(s.checks.every((c) => c.status === 'PASS')).toBe(true);
    expect(s.durationsMs.total).toBeGreaterThan(0);
    for (const k of ['hash', 'decode', 'parse', 'rows', 'validate', 'write']) expect(s.durationsMs[k]).toBeTypeOf('number');
    // Progress goes through every stage and is monotonic
    expect(new Set(progress.map((p) => p.stage))).toEqual(new Set(['reading', 'parsing', 'checking', 'writing']));
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.percent).toBeGreaterThanOrEqual(progress[i - 1]!.percent);
    expect(progress.at(-1)!.percent).toBe(100);
    for (const section of [
      'Source', 'Detected format', 'Record counts', 'Workbook rows', 'Validation checks', 'Unresolved references',
      'Duplicate IDs', 'Malformed lines', 'Warnings and limitations', 'Workbook schema (short)', 'Generated',
    ])
      expect(r.report).toContain(`\n${section}\n`);
    expect(r.report).toContain('PASS  1. Independent record count matches');
    expect(r.report).toContain('line ');
  });

  it('reports malformed lines and duplicates without blocking', async () => {
    const m = await convert({ name: 'malformed.ged', bytes: fixtureBytes('malformed.ged') });
    expect(m.ok).toBe(true);
    expect(m.summary.malformedLines.count).toBe(6);
    expect(m.report).toContain('line 8: Does not match level/tag structure: NAME Bob');
    const d = await convert({ name: 'duplicates.ged', bytes: fixtureBytes('duplicates.ged') });
    expect(d.ok).toBe(true);
    expect(d.summary.duplicateIds).toEqual(['@I1@', '@F1@']);
    expect(d.summary.checks.find((c) => c.name.startsWith('6.'))!.status).toBe('WARN');
  });

  it('returns ok:false and no workbook when a validation error is injected', async () => {
    const r = await convert(
      { name: 'basic.ged', bytes: fixtureBytes('basic.ged') },
      { afterRows: (rows) => void rows.people.rows.pop() },
    );
    expect(r.ok).toBe(false);
    expect('workbook' in r).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    expect(r.report).toContain('FAIL');
    expect(r.report).toContain('the workbook was not created');
  });

  it('passes the encoding override through', async () => {
    const r = await convert({ name: 'x.ged', bytes: bytes('0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME ', [0xe9], '\n0 TRLR\n') }, { encodingOverride: 'windows-1252' });
    expect(r.ok).toBe(true);
    expect(r.summary.usedEncoding).toBe('Windows-1252');
  });

  it('computes SHA-256 with crypto.subtle and the pure-JS fallback', async () => {
    const abc = new TextEncoder().encode('abc');
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex(abc)).toBe(expected);
    expect(await sha256Hex(abc, true)).toBe(expected);
    expect(await sha256Hex(new Uint8Array(0), true)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const big = fixtureBytes('long.ged');
    const { createHash } = await import('node:crypto');
    expect(hex(sha256Js(big))).toBe(createHash('sha256').update(big).digest('hex'));
    for (const n of [55, 56, 63, 64, 65, 119, 120]) {
      const b = new Uint8Array(n).fill(97);
      expect(hex(sha256Js(b)), `len ${n}`).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });

  it('exports the exact ChatGPT prompt', () => {
    expect(CHATGPT_PROMPT.startsWith('Use the entire attached genealogy workbook')).toBe(true);
    expect(CHATGPT_PROMPT.endsWith('explain what information is missing.')).toBe(true);
  });
});
