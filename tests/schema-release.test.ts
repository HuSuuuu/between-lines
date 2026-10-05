import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import { unzipSync } from 'fflate';
import { sourceArchive } from '../scripts/source';
import { adaptLegacy } from '../src/legacy';
import { validateChart, checkClearance } from '../src/validate';
import type { Entry } from '../src/types';
const catalog = JSON.parse(fs.readFileSync('public/catalog.json', 'utf8')).entries as Entry[];
const schema = JSON.parse(fs.readFileSync('public/chart.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
describe('public data interface and source delivery', () => {
  it('validates generated examples and every catalog chart against the public schema', () => {
    for (const chart of catalog.flatMap((e) => e.charts)) {
      expect(validate(chart), ajv.errorsText(validate.errors)).toBe(true);
    }
    const illegal = structuredClone(catalog[0].charts[0]) as any;
    illegal.script = 'execute()';
    expect(validate(illegal)).toBe(false);
  });
  it('retains synthetic legacy timing and routes without needing licensed song fixtures', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 4, y: 4 },
    ];
    const c = adaptLegacy(
      {
        title: '原版兼容测试',
        artist: '原创测试',
        duration: 5,
        tempo: 120,
        points,
        arrivalBeats: [0, 2, 4, 6, 8],
        beatTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
        notes: [{ index: 2, kind: 'double' }],
        forks: [],
        sections: [{ index: 0, endIndex: 4, label: '测试' }],
      },
      ['完整的一句歌词'],
    );
    validateChart(c);
    expect(checkClearance(c)).toBe(0);
    expect(c.events.map((n) => n.t)).toEqual([1, 2, 3]);
    expect(c.events[1].kind).toBe('double');
    expect(c.tracks[0].keys.slice(0, 5).map(({ t, ...point }) => point)).toEqual(points);
    expect(c.tracks[0].keys.at(-1)?.t).toBe(5);
  });
  it('ships reproducible source and original practice without personal songs or generated catalogs', () => {
    const original = sourceArchive();
    expect(sourceArchive()).toEqual(original);
    const files = Object.keys(unzipSync(original));
    expect(files).toContain('between-lines/package-lock.json');
    expect(files).toContain('between-lines/public/chart.schema.json');
    expect(files).toContain('between-lines/public/assets/practice.wav');
    expect(
      files.some((p) =>
        /anti-utopia\.mp3|legacy-chart\.json|legacy-lyrics\.json|catalog\.json|node_modules|\/\.git\/|proof\/|source\.zip/.test(
          p,
        ),
      ),
    ).toBe(false);
  });
});
