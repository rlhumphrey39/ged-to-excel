import type { DecodeResult } from './types';

/** Thrown when the bytes cannot be decoded. `friendly` is plain English for the page; `message` is technical. */
export class EncodingError extends Error {
  friendly: string;
  constructor(message: string, friendly?: string) {
    super(message);
    this.name = 'EncodingError';
    this.friendly =
      friendly ??
      'This file uses a kind of text encoding this page cannot read. Please export the file again from Family Tree Maker and choose UTF-8.';
  }
}

/** Values accepted for the manual override (the "Advanced: file text encoding" select). */
export type EncodingOverride = 'auto' | 'utf-8' | 'windows-1252' | 'ansel' | 'macintosh' | 'cp437' | 'utf-16';

export const ENCODING_OVERRIDES: { value: EncodingOverride; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'windows-1252', label: 'Windows (ANSI)' },
  { value: 'ansel', label: 'ANSEL' },
  { value: 'macintosh', label: 'Macintosh' },
  { value: 'cp437', label: 'IBM PC (DOS)' },
  { value: 'utf-16', label: 'Unicode (UTF-16)' },
];

// ---------------------------------------------------------------------------------------------
// CP437 (IBM PC) upper half
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeCp437(bytes: Uint8Array): string {
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    chunk += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    if (chunk.length >= 65536) {
      out.push(chunk);
      chunk = '';
    }
  }
  out.push(chunk);
  return out.join('');
}

// ---------------------------------------------------------------------------------------------
// ANSEL (Z39.47 / MARC-8 Latin) as used by GEDCOM 5.5.1
const ANSEL_SPECIAL: Record<number, string> = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·',
  0xa9: '♭', 0xaa: '®', 0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ',
  0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ', 0xb6: 'œ', 0xb7: 'ʺ',
  0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư',
  0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©', 0xc4: '♯', 0xc5: '¿', 0xc6: '¡', 0xc7: 'ß',
  0xc8: '€', 0xcf: 'ß',
};

/** Combining marks 0xE0..0xFE; they precede the base letter in ANSEL. 0 = unused. */
const ANSEL_COMBINING: number[] = [
  0x0309, 0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0306, 0x0307, // E0-E7
  0x0308, 0x030c, 0x030a, 0xfe20, 0xfe21, 0x0315, 0x030b, 0x0310, // E8-EF
  0x0327, 0x0328, 0x0323, 0x0324, 0x0325, 0x0333, 0x0332, 0x0326, // F0-F7
  0x031c, 0x032e, 0xfe22, 0xfe23, 0, 0, 0x0313, // F8-FE (FC, FD unused)
];

export function decodeAnsel(bytes: Uint8Array): { text: string; unmapped: number } {
  const out: string[] = [];
  let buf = '';
  let pending = '';
  let unmapped = 0;
  const flush = () => {
    if (buf.length) {
      out.push(buf);
      buf = '';
    }
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b >= 0xe0 && b <= 0xfe) {
      const cp = ANSEL_COMBINING[b - 0xe0]!;
      if (cp) {
        pending += String.fromCharCode(cp);
      } else {
        unmapped++;
        buf += '�';
      }
      continue;
    }
    let ch: string;
    if (b < 0x80) ch = String.fromCharCode(b);
    else {
      const s = ANSEL_SPECIAL[b];
      if (s === undefined) {
        unmapped++;
        ch = '�';
      } else ch = s;
    }
    if (pending) {
      if (ch === '\n' || ch === '\r') {
        // Marks with nothing to attach to on this line: keep them, standalone.
        buf += pending + ch;
      } else {
        buf += (ch + pending).normalize('NFC');
      }
      pending = '';
    } else {
      buf += ch;
    }
    if (buf.length >= 65536) flush();
  }
  buf += pending;
  flush();
  return { text: out.join(''), unmapped };
}

// ---------------------------------------------------------------------------------------------

function decodeUtf8Fatal(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeWith(label: string, bytes: Uint8Array): string {
  return new TextDecoder(label).decode(bytes);
}

/** Read up to the first 4 KB as latin1 (or as UTF-16 when the bytes clearly are) to find the CHAR line. */
function sniffHead(bytes: Uint8Array): { head: string; utf16?: 'utf-16le' | 'utf-16be' } {
  const n = Math.min(bytes.length, 4096);
  let utf16: 'utf-16le' | 'utf-16be' | undefined;
  if (n >= 4) {
    // "0 HEAD" in UTF-16 without BOM: 30 00 20 00 (LE) or 00 30 00 20 (BE)
    if (bytes[0] === 0x00 && bytes[1] !== 0x00 && bytes[2] === 0x00) utf16 = 'utf-16be';
    else if (bytes[0] !== 0x00 && bytes[1] === 0x00 && bytes[3] === 0x00) utf16 = 'utf-16le';
  }
  if (utf16) return { head: new TextDecoder(utf16).decode(bytes.subarray(0, n & ~1)), utf16 };
  let head = '';
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]!);
  return { head, utf16 };
}

function utf16Endianness(bytes: Uint8Array): 'utf-16le' | 'utf-16be' {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0x00 && bytes[1] === 0x30) return 'utf-16be';
  return 'utf-16le';
}

const BAD_UTF8 = (what: string) =>
  new EncodingError(
    `The file is ${what} UTF-8 but contains bytes that are not valid UTF-8. Try the "Advanced: file text encoding" setting (for example Windows (ANSI) or ANSEL).`,
    'Some letters in this file could not be read. Open "Advanced: file text encoding" at the bottom of the page and try "Windows (ANSI)" or "ANSEL", or export the file again from Family Tree Maker and choose UTF-8.',
  );

function decodeAs(
  enc: Exclude<EncodingOverride, 'auto'>,
  bytes: Uint8Array,
  warnings: string[],
  what: string,
): { text: string; usedEncoding: string } {
  switch (enc) {
    case 'utf-8': {
      const t = decodeUtf8Fatal(bytes);
      if (t === null) throw BAD_UTF8(what);
      return { text: t, usedEncoding: 'UTF-8' };
    }
    case 'windows-1252':
      return { text: decodeWith('windows-1252', bytes), usedEncoding: 'Windows-1252' };
    case 'macintosh':
      return { text: decodeWith('macintosh', bytes), usedEncoding: 'Macintosh (Mac OS Roman)' };
    case 'cp437':
      return { text: decodeCp437(bytes), usedEncoding: 'IBM PC (CP437)' };
    case 'utf-16': {
      const e = utf16Endianness(bytes);
      return { text: decodeWith(e, bytes), usedEncoding: e === 'utf-16be' ? 'UTF-16BE' : 'UTF-16LE' };
    }
    case 'ansel': {
      const r = decodeAnsel(bytes);
      if (r.unmapped > 0)
        warnings.push(
          `ANSEL: ${r.unmapped} byte(s) could not be mapped and were replaced with U+FFFD (the replacement character).`,
        );
      return { text: r.text, usedEncoding: 'ANSEL' };
    }
  }
}

/** Decode GEDCOM bytes per PLAN section 4. */
export function decodeGedcom(bytes: Uint8Array, override: EncodingOverride | string = 'auto'): DecodeResult {
  const warnings: string[] = [];
  const { head, utf16 } = sniffHead(bytes);
  const m = /^\s*1 CHAR[ \t]+(\S+)/m.exec(head);
  let declaredCharset = m ? m[1]! : '';
  if (m) {
    const after = head.slice(m.index + m[0].length);
    const v = /^[^\n]*\n\s*2 VERS[ \t]+([^\r\n]+)/.exec(after);
    if (v) declaredCharset += ` (VERS ${v[1]!.trim()})`;
  }

  const ov = (override || 'auto') as EncodingOverride;
  if (ov !== 'auto') {
    if (!ENCODING_OVERRIDES.some((o) => o.value === ov)) throw new EncodingError(`Unknown encoding override: ${ov}`);
    let body = bytes;
    if (ov === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) body = bytes.subarray(3);
    const r = decodeAs(ov as Exclude<EncodingOverride, 'auto'>, body, warnings, 'being read as');
    warnings.push(`Text encoding chosen manually: ${r.usedEncoding}.`);
    return { text: stripBom(r.text), usedEncoding: r.usedEncoding, declaredCharset, warnings };
  }

  // 1. BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const r = decodeAs('utf-8', bytes.subarray(3), warnings, 'marked as');
    return { text: stripBom(r.text), usedEncoding: 'UTF-8 (with BOM)', declaredCharset, warnings };
  }
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const r = decodeAs('utf-16', bytes, warnings, 'marked as');
    return { text: stripBom(r.text), usedEncoding: r.usedEncoding + ' (with BOM)', declaredCharset, warnings };
  }
  if (utf16 && !m) {
    warnings.push('No character set declared; the file looks like UTF-16 and was read that way.');
    return { text: stripBom(decodeWith(utf16, bytes)), usedEncoding: utf16.toUpperCase(), declaredCharset, warnings };
  }

  // 2. CHAR line
  if (!m) {
    const t = decodeUtf8Fatal(bytes);
    if (t !== null) {
      warnings.push('No character set declared; assumed UTF-8.');
      return { text: stripBom(t), usedEncoding: 'UTF-8', declaredCharset, warnings };
    }
    warnings.push('No character set declared; assumed Windows-1252 because the file is not valid UTF-8.');
    return { text: decodeWith('windows-1252', bytes), usedEncoding: 'Windows-1252', declaredCharset, warnings };
  }

  const name = m[1]!.toUpperCase();
  let r: { text: string; usedEncoding: string };
  switch (name) {
    case 'UTF-8':
    case 'UTF8':
      r = decodeAs('utf-8', bytes, warnings, 'declared');
      break;
    case 'ASCII': {
      const t = decodeUtf8Fatal(bytes);
      if (t !== null) r = { text: t, usedEncoding: 'UTF-8 (declared ASCII)' };
      else {
        warnings.push('The file is declared ASCII but contains other characters; read as Windows-1252.');
        r = { text: decodeWith('windows-1252', bytes), usedEncoding: 'Windows-1252 (declared ASCII)' };
      }
      break;
    }
    case 'ANSI':
    case 'WINDOWS-1252':
    case 'CP1252':
      r = decodeAs('windows-1252', bytes, warnings, 'declared');
      break;
    case 'LATIN1':
    case 'ISO-8859-1':
    case 'ISO8859-1':
      r = { text: decodeWith('iso-8859-1', bytes), usedEncoding: 'ISO-8859-1' };
      break;
    case 'UNICODE':
    case 'UTF-16':
    case 'UTF16':
      r = decodeAs('utf-16', bytes, warnings, 'declared');
      break;
    case 'MACINTOSH':
    case 'MACROMAN':
      r = decodeAs('macintosh', bytes, warnings, 'declared');
      break;
    case 'IBMPC':
    case 'IBM_PC':
    case 'IBM-PC':
    case 'CP437':
    case 'DOS':
      r = decodeAs('cp437', bytes, warnings, 'declared');
      break;
    case 'ANSEL':
      r = decodeAs('ansel', bytes, warnings, 'declared');
      break;
    default:
      throw new EncodingError(
        `Unsupported character set: ${m[1]}`,
        `This file uses a kind of text encoding this page cannot read (${m[1]}). Please export the file again from Family Tree Maker and choose UTF-8.`,
      );
  }
  return { text: stripBom(r.text), usedEncoding: r.usedEncoding, declaredCharset, warnings };
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
