import type { GedcomNode } from './types';
import { firstChild } from './parser';

export interface NameParts {
  given: string;
  surname: string;
  suffix: string;
}

/**
 * Split a GEDCOM NAME value "given /surname/ suffix". Spelling is never altered; only surrounding
 * whitespace of the given and suffix parts is trimmed. Empty parts fall back to GIVN/SURN/NSFX children.
 */
export function splitName(value: string, nameNode?: GedcomNode): NameParts {
  let given: string;
  let surname = '';
  let suffix = '';
  const first = value.indexOf('/');
  if (first === -1) {
    given = value.trim();
  } else {
    given = value.slice(0, first).trim();
    const second = value.indexOf('/', first + 1);
    if (second === -1) {
      surname = value.slice(first + 1);
    } else {
      surname = value.slice(first + 1, second);
      suffix = value.slice(second + 1).trim();
    }
  }
  if (nameNode) {
    if (!given) given = firstChild(nameNode, 'GIVN')?.value ?? '';
    if (!surname) surname = firstChild(nameNode, 'SURN')?.value ?? '';
    if (!suffix) suffix = firstChild(nameNode, 'NSFX')?.value ?? '';
  }
  return { given, surname, suffix };
}

/** "Surname, Given names Suffix" with blank parts omitted. */
export function surnameFirst(p: NameParts): string {
  const rest = [p.given, p.suffix].filter((s) => s !== '').join(' ');
  if (p.surname && rest) return `${p.surname}, ${rest}`;
  return p.surname || rest;
}
