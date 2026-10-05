import type { Chart, Note, Entry } from './types';
import { generate, layout } from './generator';
import { chartRevision } from './geometry';
export function adaptLegacy(old: any, lyrics: string[]): Chart {
  const at = (beat: number) =>
    beat < 0 ? 0 : (old.beatTimes[Math.floor(beat)] || 0) + ((beat % 1) * 60) / old.tempo;
  const direction = (a: any, b: any) =>
    Math.abs(b.x - a.x) > Math.abs(b.y - a.y)
      ? b.x > a.x
        ? 'right'
        : 'left'
      : b.y > a.y
        ? 'down'
        : 'up';
  const notes = new Map<number, string>((old.notes || []).map((n: any) => [n.index, n.kind])),
    forks = new Map<number, any>((old.forks || []).map((f: any) => [f.index, f]));
  const events: Note[] = [];
  for (let i = 1; i < old.points.length - 1; i++) {
    if (
      !forks.has(i) &&
      direction(old.points[i - 1], old.points[i]) === direction(old.points[i], old.points[i + 1])
    )
      continue;
    events.push({
      id: 'legacy-' + i,
      t: at(old.arrivalBeats[i]),
      kind: forks.has(i) ? 'swipe' : notes.get(i) === 'double' ? 'double' : 'tap',
      track: 0,
    });
  }
  const chart = generate({
    id: 'anti-utopia-original',
    songId: 'anti-utopia',
    title: old.title,
    artist: old.artist,
    duration: old.duration,
    events,
    lyrics: lyrics.map((text, i) => ({ id: 'legacy-line-' + i, text })),
    duets: [],
    seed: 20261005,
    tempo: old.tempo,
    template: 'inset',
  });
  // The adapter retains original authored routes, fork timing, and recording duration.
  const keys = old.points.map((p: any, i: number) => ({ ...p, t: at(old.arrivalBeats[i]) }));
  if (keys.at(-1).t < old.duration)
    keys.push({
      ...keys.at(-1),
      t: old.duration,
      y: keys.at(-1).y + (old.duration - keys.at(-1).t) * 2,
    });
  chart.tracks = [
    { id: 0, keys },
    { id: 1, keys: keys.map((k: any) => ({ ...k })) },
  ];
  chart.forks = (old.forks || []).map((f: any) => {
    const start = keys[f.index],
      a = [start, ...f.routes.A.map((p: any, i: number) => ({ ...p, t: keys[f.index + i + 1].t }))],
      b = [start, ...f.routes.B.map((p: any, i: number) => ({ ...p, t: keys[f.index + i + 1].t }))];
    return {
      eventId: 'legacy-' + f.index,
      track: 0,
      start: start.t,
      end: a.at(-1).t,
      directionA: direction(a[0], a[1]),
      directionB: direction(b[0], b[1]),
      keysA: a,
      keysB: b,
    };
  });
  chart.events = events.map((e) => ({
    ...e,
    direction:
      e.kind === 'swipe' ? chart.forks.find((f) => f.eventId === e.id)!.directionA : undefined,
  }));
  chart.chapters = old.sections.map((s: any, i: number) => ({
    id: 'legacy-section-' + i,
    title: lyrics[Math.floor((i * lyrics.length) / old.sections.length)] || s.label,
    start: at(old.arrivalBeats[s.index]),
    end: i === old.sections.length - 1 ? old.duration : at(old.arrivalBeats[s.endIndex]),
    anchor: { x: old.points[s.index].x, y: old.points[s.index].y },
  }));
  chart.groups = layout(chart);
  chart.warnings = [];
  chart.revision = chartRevision(chart);
  return chart;
}
export function builtinEntry(chart: Chart): Entry {
  return {
    id: 'anti-utopia',
    title: chart.title,
    artist: chart.artist,
    duration: chart.duration,
    audioId: 'builtin:anti-utopia',
    audioName: '反乌托邦.mp3',
    builtin: true,
    favorite: false,
    charts: [chart],
    createdAt: 0,
  };
}
