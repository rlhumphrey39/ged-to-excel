import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OOXML_URIS } from '../src/core/xlsx';
import { CSP } from '../vite.config';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/**
 * The only http(s) literals allowed in the built site: XML namespace identifiers used inside the generated
 * workbook (they are names, never fetched) and the SVG namespace in the favicon.
 */
const ALLOWED_URL_LITERALS = [...OOXML_URIS, 'http://www.w3.org/2000/svg'];

const FORBIDDEN = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'sendBeacon', 'EventSource', 'importScripts(', 'http://', 'https://'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const hasDist = existsSync(join(DIST, 'index.html'));

describe.skipIf(!hasDist)('no network (built site in dist/)', () => {
  it('dist/index.html carries the Content-Security-Policy meta tag with connect-src none', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    expect(m, 'CSP meta tag missing').toBeTruthy();
    expect(m![1]!.replace(/&#39;|&apos;/g, "'")).toBe(CSP);
    expect(CSP).toContain("connect-src 'none'");
    // No inline scripts or styles
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style/);
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('no built file contains network-capable code or URLs', () => {
    const files = walk(DIST);
    expect(files.some((f) => f.endsWith('.js'))).toBe(true);
    const offences: string[] = [];
    for (const f of files) {
      let s = readFileSync(f, 'utf8');
      for (const allowed of ALLOWED_URL_LITERALS) s = s.split(allowed).join('');
      for (const bad of FORBIDDEN) if (s.includes(bad)) offences.push(`${f.slice(DIST.length + 1)}: ${bad}`);
    }
    expect(offences).toEqual([]);
  });

  it('the worker bundle exists separately from the page bundle', () => {
    const js = walk(DIST).filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThanOrEqual(2);
  });
});

describe.runIf(!hasDist)('no network (skipped)', () => {
  it('dist/ is absent: run `npm run build` first (or `npm run test:all`)', () => {
    console.warn('no-network test skipped: dist/ not found. Run `npm run test:all`.');
    expect(hasDist).toBe(false);
  });
});
