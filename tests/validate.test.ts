import { describe, expect, it } from 'vitest';
import { validate, independentCounts } from '../src/core/validate';
import { rowsFor } from './helpers';

const run = (fx: string, mutate?: (r: ReturnType<typeof rowsFor>['rows']) => void) => {
  const { text, parse, rows } = rowsFor(fx);
  mutate?.(rows);
  return validate({ parse, text, rows });
};
const status = (v: ReturnType<typeof validate>, n: number) => v.checks.find((c) => c.name.startsWith(`${n}.`))!.status;

describe('validate', () => {
  it('passes all 10 checks on basic.ged', () => {
    const v = run('basic.ged');
    expect(v.errors).toEqual([]);
    expect(v.checks).toHaveLength(10);
    for (const c of v.checks) expect(c.status, `${c.name}: ${c.detail}`).toBe('PASS');
    expect(v.independentCounts).toEqual({ indi: 6, fam: 3 });
    expect(v.customTagsRetained).toBeGreaterThanOrEqual(4); // _MILT _MDCL _WEIRD _FREL _MREL
    expect(v.unknownTagsRetained).toBe(1); // ZZZX
  });

  it('counts unresolved references as warnings', () => {
    const v = run('basic.ged');
    expect(v.unresolvedCount).toBe(2);
    expect(v.unresolvedReferences.map((u) => `${u.tag} → ${u.target}`)).toEqual(['FAMS → @F999@', 'SOUR → @S404@']);
    expect(v.warnings.join('\n')).toMatch(/not in the file: 2/);
  });

  it('treats duplicate IDs and unresolved family links as warnings, not errors', () => {
    const v = run('duplicates.ged');
    expect(v.errors).toEqual([]);
    expect(status(v, 6)).toBe('WARN');
    expect(status(v, 2)).toBe('PASS');
    const { text, parse, rows } = rowsFor('basic.ged');
    rows.relationships.rows[0]!.cells[4] = '@I404@';
    const w = validate({ parse, text, rows });
    expect(w.errors).toEqual([]);
    expect(status(w, 5)).toBe('WARN');
  });

  it('passes on malformed, standalone, long and no-TRLR files', () => {
    for (const fx of ['malformed.ged', 'standalone.ged', 'long.ged', 'no-trlr.ged']) expect(run(fx).errors, fx).toEqual([]);
    const long = run('long.ged');
    expect(long.maxParts.people.metadata).toBeGreaterThanOrEqual(3);
    expect(long.maxParts.people.raw).toBeGreaterThanOrEqual(3);
  });

  it('flags a line-coverage hole when a row is deleted', () => {
    const v = run('basic.ged', (r) => {
      r.facts.rows = r.facts.rows.filter((x) => x.cells[2] !== '@S2@');
    });
    expect(status(v, 7)).toBe('FAIL');
    expect(v.errors.join('\n')).toMatch(/missing from the workbook/);
  });

  it('flags a removed tag', () => {
    const v = run('basic.ged', (r) => {
      r.facts.rows = r.facts.rows.filter((x) => x.cells[2] !== 'HEAD:L1');
    });
    expect(status(v, 8)).toBe('FAIL');
    expect(v.errors.join('\n')).toMatch(/CHAR/);
  });

  it('flags lost privacy', () => {
    const lostFlag = run('basic.ged', (r) => {
      for (const s of [r.people, r.facts, r.relationships]) for (const row of s.rows) row.cells = row.cells.map((c) => (c === 'Yes' ? 'No' : c));
    });
    expect(status(lostFlag, 9)).toBe('FAIL');
    const lostResn = run('basic.ged', (r) => {
      r.people.rows = r.people.rows.filter((x) => x.cells[0] !== '@I2@');
    });
    expect(status(lostResn, 9)).toBe('FAIL');
    expect(status(lostResn, 2)).toBe('FAIL');
  });

  it('flags count mismatches and unresolvable owners', () => {
    const { parse, rows } = rowsFor('basic.ged');
    const v = validate({ parse, text: '0 HEAD\n', rows });
    expect(status(v, 1)).toBe('FAIL');
    rows.facts.rows[3]!.cells[2] = '@I999@';
    rows.relationships.rows = rows.relationships.rows.filter((r) => r.cells[1] !== '@F2@');
    const w = validate({ parse, text: '', rows });
    expect(status(w, 4)).toBe('FAIL');
    expect(status(w, 3)).toBe('FAIL');
  });

  it('counts INDI/FAM lines independently of the tree', () => {
    expect(independentCounts('0 @I1@ INDI\r\n0 @F1@ FAM\n1 NOTE 0 @I2@ INDI\n0 @I3@ INDI\n')).toEqual({ indi: 2, fam: 1 });
  });
});
