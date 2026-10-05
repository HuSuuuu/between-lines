import type { Chart, Glyph, TextGroup, Vec } from './types';
import { distance, position, rectangleTouchesSegment, seeded } from './geometry';

const CELL = 4;
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Pack complete phrases first, then repeat lyric words into the remaining space. */
export function cloudLayout(chart: Chart, emphasis = ''): TextGroup[] {
  const random = seeded(chart.seed ^ 0x6c6f7564);
  const groups: TextGroup[] = [];
  const occupied = new Map<string, Glyph[]>();
  const edgeIndex = new Map<string, [Vec, Vec][]>();
  const tiles = new Map<string, { x: number; y: number; t: number }>();
  const bucket = (x: number, y: number) => Math.floor(x) + ':' + Math.floor(y);
  const lines = chart.lyrics.length ? chart.lyrics : [{ id: 'blank', text: chart.title }];
  const highlighted = emphasis
    .split(/[，,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const corpus = [
    ...new Set([chart.title, ...highlighted, ...lines.map((l) => l.text)].filter(Boolean)),
  ];
  const words: string[] = [];
  for (const phrase of corpus) {
    for (const part of phrase.split(/[，。！？、；：,.!?;:\s]+/).filter(Boolean)) {
      const chars = Array.from(part);
      if (chars.length <= 10) words.push(part);
      for (let offset = 0; offset < chars.length; offset += 3) {
        const word = chars.slice(offset, offset + 4).join('');
        if (Array.from(word).length >= 2) words.push(word);
      }
    }
  }
  if (!words.length) words.push(chart.title || '音乐');
  const shortWords = words.filter((s) => Array.from(s).length <= 4);
  if (!shortWords.length) shortWords.push(Array.from(words[0]).slice(0, 4).join(''));

  function addEdge(a: Vec, b: Vec) {
    for (
      let y = Math.floor((Math.min(a.y, b.y) - 2) / CELL);
      y <= Math.floor((Math.max(a.y, b.y) + 2) / CELL);
      y++
    )
      for (
        let x = Math.floor((Math.min(a.x, b.x) - 2) / CELL);
        x <= Math.floor((Math.max(a.x, b.x) + 2) / CELL);
        x++
      ) {
        const key = x + ':' + y;
        const edges = edgeIndex.get(key) || [];
        edges.push([a, b]);
        edgeIndex.set(key, edges);
      }
  }
  for (const track of chart.tracks) {
    for (let i = 1; i < track.keys.length; i++) {
      const a = track.keys[i - 1],
        b = track.keys[i];
      if (track.id === 1 && !chart.duets.some((d) => a.t >= d.start && b.t <= d.end)) continue;
      addEdge(a, b);
      const samples = Math.ceil(distance(a, b) / 3);
      for (let j = 0; j <= samples; j++) {
        const f = j / Math.max(1, samples),
          p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const x = Math.floor(p.x / CELL) + dx,
              y = Math.floor(p.y / CELL) + dy;
            const key = x + ':' + y;
            if (!tiles.has(key)) tiles.set(key, { x, y, t: a.t + (b.t - a.t) * f });
          }
      }
    }
  }
  for (const fork of chart.forks)
    for (let i = 1; i < fork.keysB.length; i++) addEdge(fork.keysB[i - 1], fork.keysB[i]);

  function fits(g: Glyph) {
    const half = g.size * 0.52 + 0.14;
    for (let y = Math.floor((g.y - half) / CELL); y <= Math.floor((g.y + half) / CELL); y++)
      for (let x = Math.floor((g.x - half) / CELL); x <= Math.floor((g.x + half) / CELL); x++)
        if (
          (edgeIndex.get(x + ':' + y) || []).some(([a, b]) =>
            rectangleTouchesSegment(g.x, g.y, half, a, b),
          )
        )
          return false;
    const reach = g.size / 2 + 2;
    for (let y = Math.floor(g.y - reach); y <= Math.floor(g.y + reach); y++)
      for (let x = Math.floor(g.x - reach); x <= Math.floor(g.x + reach); x++)
        if (
          (occupied.get(x + ':' + y) || []).some(
            (q) =>
              Math.abs(q.x - g.x) < (q.size + g.size) * 0.5 + 0.018 &&
              Math.abs(q.y - g.y) < (q.size + g.size) * 0.5 + 0.018,
          )
        )
          return false;
    return true;
  }
  function letters(
    text: string,
    x: number,
    y: number,
    size: number,
    vertical: boolean,
    columns = 100,
  ) {
    const chars = Array.from(text),
      rows = Math.ceil(chars.length / columns);
    return chars.map((text, i) => ({
      text,
      size,
      x: round(x + (vertical ? Math.floor(i / rows) : i % columns) * size * 1.015),
      y: round(y + (vertical ? i % rows : Math.floor(i / columns)) * size * 1.015),
    }));
  }
  function put(
    id: string,
    text: string,
    role: TextGroup['role'],
    section: number,
    glyphs: Glyph[],
    vertical: boolean,
  ) {
    if (!glyphs.every(fits)) return false;
    for (const g of glyphs) {
      const key = bucket(g.x, g.y),
        values = occupied.get(key) || [];
      values.push(g);
      occupied.set(key, values);
    }
    groups.push({
      id,
      text,
      role,
      section,
      orientation: vertical ? 'vertical' : 'horizontal',
      glyphs,
    });
    return true;
  }
  function sectionAt(t: number) {
    return Math.max(
      0,
      chart.chapters.findIndex((c) => t >= c.start && t < c.end),
    );
  }
  function placePhrase(
    id: string,
    text: string,
    role: 'hero' | 'body',
    t: number,
    size: number,
    vertical: boolean,
  ) {
    const anchor = position(chart.tracks[0].keys, t);
    const columns = vertical ? 1 : Math.min(role === 'hero' ? 6 : 8, Array.from(text).length);
    for (let radius = 0.5; radius < 28; radius += 0.38) {
      for (let turn = 0; turn < 16; turn++) {
        const angle = (turn / 16) * Math.PI * 2 + random() * 0.05;
        const x = anchor.x + Math.cos(angle) * radius - (vertical ? 0 : (columns - 1) * size * 0.5);
        const y =
          anchor.y +
          Math.sin(angle) * radius -
          (vertical ? (Array.from(text).length - 1) * size * 0.5 : 0);
        if (
          put(id, text, role, sectionAt(t), letters(text, x, y, size, vertical, columns), vertical)
        )
          return;
      }
    }
    throw Error('歌词过长，无法完整排入词云；请增加歌词分段。');
  }
  chart.chapters.forEach((chapter, i) => {
    const word =
      highlighted[i % highlighted.length] ||
      (i === 0 ? chart.title : shortWords[i % shortWords.length]);
    placePhrase(
      'hero-' + i,
      word,
      'hero',
      (chapter.start + chapter.end) / 2,
      i % 3 === 0 ? 2.85 : 2.15,
      chart.template === 'vertical',
    );
  });
  lines.forEach((line, i) => {
    const t = line.t ?? (chart.duration * (i + 0.5)) / lines.length;
    placePhrase(
      line.id + '-body',
      line.text,
      'body',
      Math.min(chart.duration - 0.0001, t),
      0.92,
      chart.template === 'vertical' || (chart.template === 'inset' && i % 5 === 3),
    );
  });
  const regions = [...tiles.values()];
  // Large words get first choice. Smaller words close the gaps, including repeated lyrics.
  for (const size of [1.16, 0.78, 0.56, 0.44, 0.36]) {
    for (const tile of regions) {
      const step = size * 0.58,
        phaseX = random() * step,
        phaseY = random() * step;
      for (
        let y = tile.y * CELL + phaseY;
        y < (tile.y + 1) * CELL;
        y += size * (size <= 0.56 ? 0.58 : 1.08)
      )
        for (let x = tile.x * CELL + phaseX; x < (tile.x + 1) * CELL; x += step) {
          if (groups.length >= 9500) return groups;
          const vertical =
            chart.template === 'vertical'
              ? random() < 0.7
              : chart.template === 'horizontal'
                ? random() < 0.06
                : random() < 0.18;
          const pool = size <= 0.56 ? shortWords : words;
          const attempts = size <= 0.56 ? 4 : 1;
          for (let attempt = 0; attempt < attempts; attempt++) {
            const text = pool[Math.floor(random() * pool.length)];
            if (
              put(
                'cloud-' + groups.length,
                text,
                'fill',
                sectionAt(tile.t),
                letters(text, x, y, size, vertical, vertical ? 1 : 100),
                vertical,
              )
            )
              break;
          }
        }
    }
  }
  return groups;
}
