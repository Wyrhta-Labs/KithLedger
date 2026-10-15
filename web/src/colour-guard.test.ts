import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Hard-coded Tailwind palette classes. Presentation colour must come from the
 *  theme tokens in index.css, or dark mode breaks. Same pattern as Heorth's guard. */
const PALETTE = /\b(bg|text|border|ring|divide|from|to|fill|stroke|placeholder|outline|accent|shadow)-(white|black|(gray|slate|zinc|neutral|stone|red|green|blue|yellow|orange|amber|emerald|indigo|purple|pink|rose|teal|cyan|lime|violet|sky|fuchsia)-[0-9]{2,3})\b/g;
const HEX = /#[0-9a-fA-F]{6}\b/g;

/** Allowed per file, with the reason. A new entry says which kind it is. */
const ALLOW: Record<string, { classes?: string[]; hex?: true; why: string }> = {};

const SRC = resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('colour guard', () => {
  it('no presentation colour outside the theme tokens', () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).split('\\').join('/');
      const text = readFileSync(path, 'utf8');
      const allow = ALLOW[rel];
      const classes = [...text.matchAll(PALETTE)].map((m) => m[0]).filter((c) => !allow?.classes?.includes(c));
      const hexes = allow?.hex ? [] : [...text.matchAll(HEX)].map((m) => m[0]);
      for (const hit of [...classes, ...hexes]) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});
