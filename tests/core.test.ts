import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { generate } from '../src/generator';
import { Engine } from '../src/engine';
import { validateChart, checkClearance } from '../src/validate';
import { position, distance, forkDecisionEnd, pointSegment } from '../src/geometry';
import { parseLyrics, lyricsAsLrc } from '../src/lyrics';
import type { Chart, GenerationRequest, Entry } from '../src/types';
const catalog = JSON.parse(fs.readFileSync('public/catalog.json', 'utf8')) as { entries: Entry[] };
const request: GenerationRequest = {
  id: 'custom',
  songId: 'custom-song',
  title: '雨后',
  artist: 'test',
  duration: 31.7,
  events: [
    0.341, 1.057, 1.683, 2.252, 3.01, 3.487, 4.009, 4.583, 5.22, 5.718, 6.291, 6.879, 7.4, 8.021,
    9.1, 10.8, 12.77, 15.11, 16.85, 18.203, 20.541, 22.987, 25.131, 28.301,
  ].map((t, i) => ({ id: 'n' + i, t, kind: i % 7 === 2 ? 'double' : 'tap', track: 0 })),
  lyrics: parseLyrics(
    '雨后，沿着文字走\n每一拍都有自己的时间\n这是完整的一句话\n海与山不会遗失\nOutside the printed page',
  ),
  duets: [{ id: 'verse', start: 1, end: 9 }],
  seed: 1234,
  template: 'inset',
};
describe('deterministic authoring and typography', () => {
  it('retains every arbitrary tap timestamp without adding judgments or forcing BPM', () => {
    const a = generate(request),
      b = generate(request);
    expect(a).toEqual(b);
    expect(a.events.map((e) => e.t)).toEqual(request.events.map((e) => e.t));
    expect(a.events).toHaveLength(request.events.length);
    expect(a.duets.length).toBeGreaterThan(0);
    validateChart(a);
    expect(checkClearance(a)).toBe(0);
    expect(a.groups.filter((g) => g.role === 'body').map((g) => g.text)).toEqual(
      request.lyrics.map((l) => l.text),
    );
    for (const g of a.groups.filter((g) => g.role === 'body'))
      expect(g.glyphs.map((v) => v.text).join('')).toBe(g.text);
  });
  it('packs repeated lyric words densely around routes without losing the originals', () => {
    const chart = generate(request);
    const fill = chart.groups.filter((g) => g.role === 'fill');
    expect(fill.length).toBeGreaterThan(150);
    expect(new Set(fill.map((g) => g.text)).size).toBeLessThan(fill.length / 2);
    const glyphs = chart.groups.flatMap((g) => g.glyphs);
    const sizes = glyphs.map((g) => g.size);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(7);
    const edges = chart.tracks.flatMap((track) =>
      track.keys.slice(1).map((b, i) => [track.keys[i], b] as const),
    );
    for (const t of [1, 9, 18, 28]) {
      const center = position(chart.tracks[0].keys, t);
      let available = 0,
        filled = 0;
      for (let y = center.y - 4; y < center.y + 4; y += 0.25)
        for (let x = center.x - 4; x < center.x + 4; x += 0.25) {
          if (edges.some(([a, b]) => pointSegment({ x, y }, a, b) < 0.25)) continue;
          available++;
          if (glyphs.some((g) => Math.abs(g.x - x) < g.size / 2 && Math.abs(g.y - y) < g.size / 2))
            filled++;
        }
      expect(filled / available).toBeGreaterThan(0.5);
    }
    expect(checkClearance(chart)).toBe(0);
  });
  it('regeneration changes composition, not captured input or timing', () => {
    const a = generate(request),
      b = generate({ ...request, seed: 9123, template: 'vertical' });
    expect(b.events.map((e) => e.t)).toEqual(a.events.map((e) => e.t));
    expect(b.groups).not.toEqual(a.groups);
  });
  it('changes only composition when selecting another seed variant', () => {
    const a = generate(request),
      b = generate({ ...request, seed: 9123 });
    expect(b.groups).not.toEqual(a.groups);
    expect(b.events.map((e) => e.t)).toEqual(a.events.map((e) => e.t));
    validateChart(b);
    expect(checkClearance(b)).toBe(0);
  });
  it('runs two reflected paths at constant speed and meets at both ends', () => {
    const c = generate(request);
    for (const d of c.duets) {
      expect(
        distance(position(c.tracks[0].keys, d.start), position(c.tracks[1].keys, d.start)),
      ).toBeLessThan(0.0001);
      expect(
        distance(position(c.tracks[0].keys, d.end), position(c.tracks[1].keys, d.end)),
      ).toBeLessThan(0.0001);
    }
    for (const tr of c.tracks)
      for (let i = 1; i < tr.keys.length; i++) {
        expect(
          distance(tr.keys[i], tr.keys[i - 1]) / (tr.keys[i].t - tr.keys[i - 1].t),
        ).toBeCloseTo(2, 4);
      }
  });
  it('supports absent lyrics and metadata LRC with multiple timestamps', () => {
    validateChart(generate({ ...request, lyrics: [] }));
    const lines = parseLyrics('[ar:Someone]\n[offset:100]\n[00:01.50][00:03.20]完整一句\n普通歌词');
    expect(lines).toEqual([
      { id: 'lyric-0', text: '完整一句', paragraph: 0, t: 1.6 },
      { id: 'lyric-1', text: '完整一句', paragraph: 0, t: 3.3000000000000003 },
      { id: 'lyric-2', text: '普通歌词', paragraph: 0 },
    ]);
  });
  it('preserves plain-text paragraph boundaries and literal lyric brackets', () => {
    const input = '字里[不是元数据]\n这一句属于同段\n\n第二段的词';
    const lines = parseLyrics(input);
    expect(lines.map((l) => l.paragraph)).toEqual([0, 0, 1]);
    expect(lyricsAsLrc(lines)).toBe(input);
    expect(
      generate({ ...request, lyrics: lines })
        .groups.filter((g) => g.role === 'body')
        .map((g) => g.text),
    ).toEqual(lines.map((l) => l.text));
  });
  it('orders repeated LRC verses by timestamps, preserving every full sentence', () => {
    const lines = parseLyrics('[00:01][00:07]第一句\n[00:02][00:08]第二句');
    expect(lines.map((l) => l.t)).toEqual([1, 2, 7, 8]);
    expect(lines.map((l) => l.text)).toEqual(['第一句', '第二句', '第一句', '第二句']);
  });
  it('rejects incomplete words, invalid raw input and mismatched split endpoints', () => {
    const c = generate(request);
    const text = structuredClone(c);
    text.groups[0].glyphs.pop();
    expect(() => validateChart(text)).toThrow(/缺字/);
    const raw = structuredClone(c);
    raw.events[0].rawTimes = [NaN];
    expect(() => validateChart(raw)).toThrow(/原始/);
    const duet = structuredClone(c);
    duet.duets[0].start += 0.1;
    expect(() => validateChart(duet)).toThrow(/分合/);
  });
  it('rejects NaN, overlapping taps, unresolved swipes and discontinuous paths', () => {
    expect(() =>
      generate({ ...request, events: [{ id: 'nan', t: NaN, kind: 'tap', track: 0 }] }),
    ).toThrow();
    const c = generate(request);
    const wrong = structuredClone(c);
    wrong.tracks[0].keys[1].x += 3;
    expect(() => validateChart(wrong)).toThrow(/速度/);
    const swipe = structuredClone(c);
    swipe.events[0].kind = 'swipe';
    expect(() => validateChart(swipe)).toThrow(/岔路/);
  });
});
describe('explicit judgment, both full songs and every branch', () => {
  for (const entry of catalog.entries)
    for (const chart of entry.charts)
      for (const difficulty of ['basic', 'standard'])
        it(entry.title + ' / ' + chart.id + ' / ' + difficulty + ' is fully playable', () => {
          validateChart(chart);
          const engine = new Engine(chart, difficulty);
          for (const note of engine.events) {
            engine.tick(note.t - 0.035);
            const result = engine.hit(
              note.t,
              note.kind,
              note.kind === 'double' ? note.t - 0.025 : undefined,
              chart.forks.find((f) => f.eventId === note.id)?.directionA,
            );
            expect(result?.grade).toBe('PERFECT');
          }
          engine.tick(chart.duration + 0.5);
          expect(engine.result().score).toBe(1000);
          expect(engine.result().miss).toBe(0);
        });
  it('has equal-scoring A and B routes, preserved timed shape lengths', () => {
    const chart = catalog.entries.flatMap((e) => e.charts).find((c) => c.forks.length)!;
    const result = (route: 'A' | 'B') => {
      const e = new Engine(chart);
      for (const n of e.events) {
        e.tick(n.t - 0.04);
        const f = chart.forks.find((f) => f.eventId === n.id);
        e.hit(
          n.t - 0.03,
          n.kind,
          n.kind === 'double' ? n.t - 0.04 : undefined,
          f ? (route === 'A' ? f.directionA : f.directionB) : undefined,
        );
      }
      e.tick(chart.duration + 0.5);
      return e.result();
    };
    const a = result('A'),
      b = result('B');
    expect(a.score).toBe(1000);
    expect(b.score).toBe(1000);
    expect(a.routes).not.toEqual(b.routes);
  });
  it('accepts slightly late branch inputs without delaying or teleporting the ball', () => {
    const c = catalog.entries
        .flatMap((e) => e.charts)
        .find((c) => c.forks.some((f) => forkDecisionEnd(f) > f.start))!,
      f = c.forks.find((f) => forkDecisionEnd(f) > f.start)!;
    const chosenAt = f.start + 0.04,
      paintedAt = chosenAt;
    const a = new Engine(c),
      b = new Engine(c),
      before = b.ball(0, paintedAt);
    expect(a.hit(chosenAt, 'swipe', undefined, f.directionA)?.grade).toBe('PERFECT');
    expect(b.hit(chosenAt, 'swipe', undefined, f.directionB)?.grade).toBe('PERFECT');
    expect(a.score()).toBe(b.score());
    expect(distance(b.ball(0, paintedAt), before)).toBeLessThan(1e-8);
    expect(distance(before, position(c.tracks[0].keys, paintedAt))).toBeLessThan(1e-8);
    const tooLate = forkDecisionEnd(f) + 0.001;
    for (const direction of [f.directionA, f.directionB]) {
      const e = new Engine(c);
      e.tick(tooLate);
      expect(e.hit(tooLate, 'swipe', undefined, direction)).toBeUndefined();
      expect(e.judged.get(f.eventId)?.grade).toBe('MISS');
    }
  });
  it('requires two fresh contacts within 80ms and counts a note once', () => {
    const chart = generate(request),
      engine = new Engine(chart),
      n = engine.events.find((e) => e.kind === 'double')!;
    expect(engine.hit(n.t, 'tap')).toBeUndefined();
    expect(engine.hit(n.t, 'double', n.t - 0.081)).toBeUndefined();
    expect(engine.hit(n.t + 0.02, 'double', n.t - 0.04)?.grade).toBe('PERFECT');
    expect(engine.hit(n.t, 'double', n.t)).toBeUndefined();
    expect(engine.judged.size).toBe(1);
    expect(engine.judged.get(n.id)?.offset).toBeCloseTo(-0.04);
  });
  it('misses do not stop either ball and missed runs cannot earn score', () => {
    const c = generate(request),
      e = new Engine(c);
    e.tick(c.duration + 0.5);
    expect(e.result().score).toBe(0);
    expect(e.result().miss).toBe(c.events.length);
    expect(e.ball(0, 3.21)).toEqual(position(c.tracks[0].keys, 3.21));
  });
  it('one global hit cannot judge the other lane or two separate times', () => {
    const c = generate(request),
      e = new Engine(c);
    for (const n of c.events.filter((n) => n.kind === 'tap').slice(0, 3)) e.hit(n.t, 'tap');
    expect(e.judged.size).toBe(3);
    expect(e.upcoming()).toHaveLength(3);
  });
});
