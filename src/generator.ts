import { cloudLayout } from './cloud-layout';
import type {
  Chart,
  GenerationRequest,
  Keyframe,
  Note,
  TextGroup,
  Vec,
  Fork,
  Chapter,
} from './types';
import { distance, FORK_INPUT_GRACE, position, reflect, seeded, chartRevision } from './geometry';
const round = (n: number) => Math.round(n * 1e6) / 1e6;
export function estimateTempo(events: Note[]): number {
  const d = events
    .slice(1)
    .map((e, i) => e.t - events[i].t)
    .filter((d) => d > 0.18 && d < 1.5)
    .sort((a, b) => a - b);
  if (!d.length) return 120;
  let bpm = 60 / d[Math.floor(d.length / 2)];
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}
export function generate(req: GenerationRequest): Chart {
  const duration = req.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw Error('音乐时长无效');
  const events = req.events.map((e) => ({ ...e, track: 0 as 0 | 1 })).sort((a, b) => a.t - b.t);
  if (events.some((e) => !Number.isFinite(e.t) || e.t < 0 || e.t >= duration))
    throw Error('节奏点必须位于音乐范围内');
  if (events.some((e, i) => i > 0 && e.t - events[i - 1].t < 0.035))
    throw Error('相邻节奏点过近，请合为双押或移动');
  const random = seeded(req.seed),
    speed = 2,
    tempo = req.tempo || estimateTempo(events),
    keys: Keyframe[] = [{ t: 0, x: 0, y: 0 }],
    warnings: string[] = [];
  let direction = 0;
  const vectors = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ],
    chapterStarts = [0];
  // Every captured event is one authored corner. Geometry never creates a new judgment.
  for (let i = 0; i <= events.length; i++) {
    const t = i < events.length ? events[i].t : duration;
    if (t <= keys.at(-1)!.t + 1e-8) continue;
    const last = keys.at(-1)!,
      len = (t - last.t) * speed,
      v = vectors[direction];
    keys.push({ t, x: round(last.x + v.x * len), y: round(last.y + v.y * len) });
    if (i < events.length) {
      const chapter = Math.floor(i / 16),
        axis = chapter % 4;
      let turn = random() < 0.5 ? 1 : 3;
      const preferred = axis % 2 === 0 ? 0 : 1;
      if (direction % 2 === 0) {
        const x = keys.at(-1)!.x;
        turn = x > chapter * 3 + 1 ? 1 : 3;
      } else {
        turn = direction === 1 ? 3 : 1;
        if (axis === 2 || axis === 3) turn = direction === 1 ? 1 : 3;
      }
      direction = (direction + turn) % 4;
      if (i > 0 && i % 16 === 0) {
        chapterStarts.push(t);
        direction = preferred === 0 ? (axis === 2 ? 2 : 0) : axis === 3 ? 3 : 1;
      }
    }
  }
  const tracks: Chart['tracks'] = [
      { id: 0, keys },
      { id: 1, keys: keys.map((k) => ({ ...k })) },
    ],
    duets: Chart['duets'] = [];
  for (const range of req.duets) {
    const inside = events.filter((e) => e.t >= range.start && e.t <= range.end);
    for (let j = 0; j < inside.length; j += 4) {
      const chunk = inside.slice(j, j + 4);
      if (chunk.length < 2) continue;
      const first = keys.findIndex((k) => k.t === chunk[0].t),
        last = keys.findIndex((k) => k.t === chunk.at(-1)!.t);
      if (first < 0 || last <= first + 1) continue;
      const a = keys[first],
        b = keys[last],
        mirrored = keys.slice(first, last + 1).map((k) => ({ ...reflect(k, a, b), t: k.t }));
      const spread = Math.max(...mirrored.map((m, i) => distance(m, keys[first + i])));
      if (spread < 0.35 || spread > 7) {
        warnings.push('一段双球距离不适合读谱，保留单球；可缩短该段或增加节奏点。');
        continue;
      }
      if (duets.some((d) => a.t < d.end + 0.15 && b.t > d.start - 0.15)) continue;
      duets.push({ id: range.id + '-' + j, start: a.t, end: b.t });
      mirrored.forEach((k, i) => (tracks[1].keys[first + i] = k));
      for (const e of chunk) {
        if (e.t > a.t && e.t < b.t) e.track = (chunk.indexOf(e) % 2) as 0 | 1;
      }
    }
  }
  const forks: Fork[] = [];
  for (const event of events.filter((e) => e.kind === 'swipe')) {
    const i = keys.findIndex((k) => k.t === event.t),
      end = Math.min(keys.length - 1, i + 2);
    if (
      i < 0 ||
      end <= i + 1 ||
      duets.some((d) => event.t < d.end + 0.42 && keys[end].t > d.start - 0.42) ||
      forks.some((f) => event.t < f.end) ||
      events.some((e) => e.id !== event.id && Math.abs(e.t - event.t) < 0.42)
    ) {
      event.kind = 'tap';
      warnings.push('一个岔路与邻近操作重叠，改为单击；节奏时间保留。');
      continue;
    }
    const a = keys[i],
      b = keys[end],
      approach = { ...position(keys, a.t + FORK_INPUT_GRACE), t: a.t + FORK_INPUT_GRACE },
      tail = keys.slice(i + 1, end + 1).map((k) => ({ ...k })),
      keysA = [{ ...a }, approach, ...tail],
      keysB = [
        { ...a },
        { ...approach },
        ...tail.map((k) => ({ ...reflect(k, approach, b), t: k.t })),
      ];
    if (distance(keysA[2], keysB[2]) < 0.3) {
      event.kind = 'tap';
      warnings.push('该位置无法形成清楚的岔路，保留单击。');
      continue;
    }
    const dir = (p: Vec): Note['direction'] =>
      Math.abs(p.x - approach.x) > Math.abs(p.y - approach.y)
        ? p.x > approach.x
          ? 'right'
          : 'left'
        : p.y > approach.y
          ? 'down'
          : 'up';
    const directionA = dir(keysA[2]),
      directionB = dir(keysB[2]);
    if (directionA === directionB) {
      event.kind = 'tap';
      warnings.push('该岔路方向不明确，保留单击。');
      continue;
    }
    event.direction = directionA;
    forks.push({
      eventId: event.id,
      track: 0,
      start: a.t,
      end: b.t,
      directionA,
      directionB,
      keysA,
      keysB,
    });
  }
  // Plain-text paragraph boundaries organize chapters without adding any input event.
  req.lyrics.forEach((line, i) => {
    if (i && line.paragraph !== undefined && line.paragraph !== req.lyrics[i - 1].paragraph) {
      const t = line.t ?? (duration * i) / req.lyrics.length;
      if (t > 0 && t < duration) chapterStarts.push(t);
    }
  });
  const starts = [...new Set(chapterStarts)].sort((a, b) => a - b),
    chapters: Chapter[] = starts.map((start, i) => ({
      id: 'chapter-' + i,
      title: req.lyrics[i]?.text || '第 ' + (i + 1) + ' 段',
      start,
      end: starts[i + 1] ?? duration,
      anchor: position(keys, start),
    }));
  const chart: Chart = {
    version: 11,
    id: req.id,
    songId: req.songId,
    title: req.title,
    artist: req.artist,
    duration,
    revision: '',
    seed: req.seed,
    tempo,
    speed,
    events,
    tracks,
    duets,
    forks,
    groups: [],
    chapters,
    lyrics: req.lyrics.map((l) => ({ ...l })),
    template: req.template || 'inset',
    warnings,
  };
  chart.groups = layout(chart, req.emphasis || '');
  chart.revision = chartRevision(chart);
  return chart;
}
export function layout(chart: Chart, emphasis = ''): TextGroup[] {
  return cloudLayout(chart, emphasis);
}
