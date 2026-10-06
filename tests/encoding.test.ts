import { describe, expect, it } from 'vitest';
import { decodeGedcom, EncodingError, decodeAnsel } from '../src/core/encoding';
import { bytes, fixtureBytes } from './helpers';

const head = (charset: string) => `0 HEAD\n1 CHAR ${charset}\n0 @I1@ INDI\n1 NAME `;

describe('encoding', () => {
  it('decodes declared UTF-8', () => {
    const r = decodeGedcom(fixtureBytes('basic.ged'));
    expect(r.usedEncoding).toBe('UTF-8');
    expect(r.declaredCharset).toBe('UTF-8');
    expect(r.text.startsWith('0 HEAD')).toBe(true);
  });

  it('strips a UTF-8 BOM (bom.ged)', () => {
    const b = bytes([0xef, 0xbb, 0xbf], head('UTF-8'), [0xc3, 0xa9], '\n');
    const r = decodeGedcom(b);
    expect(r.usedEncoding).toContain('UTF-8');
    expect(r.text.charCodeAt(0)).toBe(0x30);
    expect(r.text).toContain('NAME é');
  });

  it('decodes UTF-16LE with BOM (utf16.ged)', () => {
    const text = head('UNICODE') + 'Zoë\n';
    const body = Buffer.from(text, 'utf16le');
    const r = decodeGedcom(bytes([0xff, 0xfe], [...body]));
    expect(r.usedEncoding).toContain('UTF-16LE');
    expect(r.text).toBe(text);
  });

  it('decodes UTF-16BE without BOM when declared UNICODE', () => {
    const text = head('UNICODE') + 'Zoë\n';
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1]!;
      be[i + 1] = le[i]!;
    }
    const r = decodeGedcom(new Uint8Array(be));
    expect(r.text).toBe(text);
  });

  it('decodes ANSI as Windows-1252 (cp1252.ged)', () => {
    const r = decodeGedcom(bytes(head('ANSI'), [0xe9, 0x80], '\n'));
    expect(r.usedEncoding).toBe('Windows-1252');
    expect(r.text).toContain('NAME é€');
  });

  it('decodes ANSEL with combining marks before the base letter (ansel.ged)', () => {
    const r = decodeGedcom(bytes(head('ANSEL'), [0xe2, 0x65], ' ', [0xa1], 'odz\n'));
    expect(r.usedEncoding).toBe('ANSEL');
    expect(r.text).toContain('NAME é Łodz');
    expect(r.warnings).toEqual([]);
  });

  it('counts unmapped ANSEL bytes and warns', () => {
    const r = decodeAnsel(new Uint8Array([0x41, 0xaf, 0x42, 0xfc]));
    expect(r.unmapped).toBe(2);
    expect(r.text).toBe('A�B�');
    const d = decodeGedcom(bytes(head('ANSEL'), [0xaf], '\n'));
    expect(d.warnings.join(' ')).toMatch(/1 byte\(s\) could not be mapped/);
  });

  it('decodes MACINTOSH and IBMPC', () => {
    expect(decodeGedcom(bytes(head('MACINTOSH'), [0x8e], '\n')).text).toContain('NAME é');
    expect(decodeGedcom(bytes(head('IBMPC'), [0x82], '\n')).text).toContain('NAME é');
  });

  it('throws EncodingError for bad UTF-8 (bad-utf8.ged)', () => {
    const b = bytes(head('UTF-8'), [0xe9], '\n');
    expect(() => decodeGedcom(b)).toThrow(EncodingError);
    expect(() => decodeGedcom(b)).toThrow(/not valid UTF-8/);
  });

  it('throws a clear error for an unsupported charset', () => {
    expect(() => decodeGedcom(bytes(head('KLINGON'), '\n'))).toThrow(/Unsupported character set: KLINGON/);
    try {
      decodeGedcom(bytes(head('KLINGON'), '\n'));
    } catch (e) {
      expect((e as EncodingError).friendly).toMatch(/cannot read \(KLINGON\)/);
    }
  });

  it('falls back to Windows-1252 for invalid ASCII and for undeclared non-UTF-8', () => {
    const a = decodeGedcom(bytes(head('ASCII'), [0xe9], '\n'));
    expect(a.text).toContain('NAME é');
    expect(a.warnings.length).toBe(1);
    const n = decodeGedcom(bytes('0 HEAD\n0 @I1@ INDI\n1 NAME ', [0xe9], '\n'));
    expect(n.usedEncoding).toBe('Windows-1252');
    expect(n.warnings[0]).toMatch(/No character set declared/);
    const u = decodeGedcom(bytes('0 HEAD\n1 NAME x\n'));
    expect(u.usedEncoding).toBe('UTF-8');
    expect(u.warnings[0]).toMatch(/assumed UTF-8/);
  });

  it('honours the manual override', () => {
    const b = bytes(head('UTF-8'), [0xe9], '\n');
    const r = decodeGedcom(b, 'windows-1252');
    expect(r.text).toContain('NAME é');
    expect(r.usedEncoding).toBe('Windows-1252');
    const s = decodeGedcom(bytes(head('ANSI'), [0xe2, 0x65], '\n'), 'ansel');
    expect(s.text).toContain('NAME é');
  });
});
