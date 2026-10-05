import type { Chart } from './types';
import { distance, rectangleTouchesSegment, position } from './geometry';
export function validateChart(value: unknown): asserts value is Chart {
  try {
    inspectChart(value);
  } catch (error) {
    if (error instanceof TypeError) throw Error('谱面数据不完整或类型错误');
    throw error;
  }
}
function inspectChart(value: unknown) {
  const c = value as Chart;
  if (
    !c ||
    c.version !== 11 ||
    typeof c.id !== 'string' ||
    typeof c.songId !== 'string' ||
    typeof c.title !== 'string' ||
    typeof c.artist !== 'string' ||
    typeof c.revision !== 'string'
  )
    throw Error('不支持的谱面版本或作品信息');
  if (
    !Number.isFinite(c.duration) ||
    c.duration <= 0 ||
    !Number.isFinite(c.speed) ||
    c.speed <= 0 ||
    !Number.isFinite(c.tempo) ||
    c.tempo <= 0
  )
    throw Error('时长、速度或节奏无效');
  for (const key of ['events', 'tracks', 'duets', 'forks', 'groups', 'chapters', 'lyrics'] as const)
    if (!Array.isArray(c[key])) throw Error('谱面缺少 ' + key);
  if (
    !Number.isInteger(c.seed) ||
    !['horizontal', 'vertical', 'inset'].includes(c.template) ||
    !Array.isArray(c.warnings) ||
    c.warnings.some((w) => typeof w !== 'string') ||
    !c.chapters.length
  )
    throw Error('构图信息无效');
  if (c.events.length > 50000 || c.groups.length > 10000) throw Error('谱面过大');
  const ids = new Set<string>();
  let last = -Infinity;
  for (const e of c.events) {
    if (
      typeof e.id !== 'string' ||
      ids.has(e.id) ||
      !['tap', 'double', 'swipe'].includes(e.kind) ||
      ![0, 1].includes(e.track) ||
      !Number.isFinite(e.t) ||
      e.t < 0 ||
      e.t >= c.duration ||
      e.t - last < 0.035
    )
      throw Error('节奏事件重复、过密或无效');
    if (
      e.rawTimes !== undefined &&
      (!Array.isArray(e.rawTimes) ||
        e.rawTimes.length < 1 ||
        e.rawTimes.length > 2 ||
        e.rawTimes.some((t) => !Number.isFinite(t) || t < 0 || t > c.duration))
    )
      throw Error('原始点击时间无效');
    if (e.direction !== undefined && !['left', 'right', 'up', 'down'].includes(e.direction))
      throw Error('方向无效');
    ids.add(e.id);
    last = e.t;
  }
  if (c.tracks.length !== 2 || c.tracks[0].id !== 0 || c.tracks[1].id !== 1)
    throw Error('首版需要主路线和辅助路线');
  for (const track of c.tracks) {
    if (!Array.isArray(track.keys) || track.keys.length < 2 || track.keys.length > 100000)
      throw Error('路线不完整');
    if (Math.abs(track.keys[0].t) > 0.001 || Math.abs(track.keys.at(-1)!.t - c.duration) > 0.001)
      throw Error('路线必须覆盖整首音乐');
    for (let i = 0; i < track.keys.length; i++) {
      const k = track.keys[i];
      if (![k.x, k.y, k.t].every(Number.isFinite)) throw Error('路线坐标无效');
      if (i) {
        const a = track.keys[i - 1];
        if (k.t <= a.t || Math.abs(distance(a, k) / (k.t - a.t) - c.speed) > 0.035)
          throw Error('路线速度不连续');
      }
    }
  }
  let end = -1;
  for (const d of [...c.duets].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(d.start) ||
      !Number.isFinite(d.end) ||
      d.start < 0 ||
      d.end <= d.start ||
      d.end > c.duration ||
      d.start < end
    )
      throw Error('双球段落重叠或无效');
    if (
      distance(position(c.tracks[0].keys, d.start), position(c.tracks[1].keys, d.start)) > 0.002 ||
      distance(position(c.tracks[0].keys, d.end), position(c.tracks[1].keys, d.end)) > 0.002
    )
      throw Error('双球没有在段落边界分合');
    end = d.end;
  }
  for (const e of c.events)
    if (e.track === 1 && !c.duets.some((d) => e.t > d.start && e.t < d.end))
      throw Error('辅助球判定不在双球段落内');
  let forkEnd = -1;
  for (const f of [...c.forks].sort((a, b) => a.start - b.start)) {
    if (
      !c.events.some(
        (e) => e.id === f.eventId && e.kind === 'swipe' && Math.abs(e.t - f.start) < 1e-6,
      ) ||
      f.track !== 0 ||
      !['left', 'right', 'up', 'down'].includes(f.directionA || '') ||
      !['left', 'right', 'up', 'down'].includes(f.directionB || '') ||
      f.directionA === f.directionB ||
      !Number.isFinite(f.start) ||
      !Number.isFinite(f.end) ||
      !Array.isArray(f.keysA) ||
      !Array.isArray(f.keysB) ||
      f.start < forkEnd ||
      f.end <= f.start ||
      f.end > c.duration ||
      f.keysA.length !== f.keysB.length ||
      f.keysA.length < 3
    )
      throw Error('岔路定义无效');
    if (
      c.duets.some((d) => f.start < d.end + 0.42 && f.end > d.start - 0.42) ||
      c.events.some((e) => e.id !== f.eventId && Math.abs(e.t - f.start) < 0.42)
    )
      throw Error('岔路与其他操作冲突');
    for (let i = 0; i < f.keysA.length; i++) {
      const a = f.keysA[i],
        b = f.keysB[i];
      if (![a.x, a.y, a.t, b.x, b.y, b.t].every(Number.isFinite) || Math.abs(a.t - b.t) > 1e-6)
        throw Error('岔路时间不一致');
      if (i) {
        for (const route of [f.keysA, f.keysB])
          if (
            Math.abs(distance(route[i - 1], route[i]) / (route[i].t - route[i - 1].t) - c.speed) >
            0.035
          )
            throw Error('岔路速度不一致');
      }
    }
    for (const i of [0, f.keysA.length - 1])
      if (
        distance(f.keysA[i], f.keysB[i]) > 0.001 ||
        distance(f.keysA[i], position(c.tracks[0].keys, f.keysA[i].t)) > 0.002
      )
        throw Error('岔路没有正确汇合');
    if (Math.abs(f.keysA[0].t - f.start) > 1e-6 || Math.abs(f.keysA.at(-1)!.t - f.end) > 1e-6)
      throw Error('岔路边界时间不一致');
    forkEnd = f.end;
  }
  if (c.events.some((e) => e.kind === 'swipe' && !c.forks.some((f) => f.eventId === e.id)))
    throw Error('滑动事件缺少岔路');
  let glyphs = 0;
  for (const group of c.groups) {
    if (
      typeof group.id !== 'string' ||
      !Number.isInteger(group.section) ||
      group.section < 0 ||
      group.section >= c.chapters.length ||
      typeof group.text !== 'string' ||
      !Array.isArray(group.glyphs) ||
      !['horizontal', 'vertical'].includes(group.orientation) ||
      !['body', 'hero'].includes(group.role)
    )
      throw Error('文字组无效');
    if (group.glyphs.map((g) => g.text).join('') !== group.text)
      throw Error('文字组缺字或顺序不一致');
    for (const g of group.glyphs) {
      if (
        typeof g.text !== 'string' ||
        ![g.x, g.y, g.size].every(Number.isFinite) ||
        g.size <= 0 ||
        g.size > 50
      )
        throw Error('字形无效');
      glyphs++;
    }
  }
  if (glyphs > 150000) throw Error('歌词地图过大');
  for (const l of c.lyrics)
    if (
      typeof l.id !== 'string' ||
      typeof l.text !== 'string' ||
      (l.paragraph !== undefined && (!Number.isInteger(l.paragraph) || l.paragraph < 0)) ||
      (l.t !== undefined && (!Number.isFinite(l.t) || l.t < 0 || l.t > c.duration))
    )
      throw Error('歌词时间无效');
  for (const p of c.chapters)
    if (
      typeof p.id !== 'string' ||
      !p.anchor ||
      ![p.anchor.x, p.anchor.y].every(Number.isFinite) ||
      !Number.isFinite(p.start) ||
      !Number.isFinite(p.end) ||
      p.start < 0 ||
      p.end < p.start ||
      p.end > c.duration ||
      typeof p.title !== 'string'
    )
      throw Error('段落无效');
}
export function checkClearance(chart: Chart): number {
  let failures = 0;
  const edges: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const tr of chart.tracks)
    for (let i = 1; i < tr.keys.length; i++) {
      if (
        tr.id === 1 &&
        !chart.duets.some((d) => tr.keys[i - 1].t >= d.start && tr.keys[i].t <= d.end)
      )
        continue;
      edges.push({ a: tr.keys[i - 1], b: tr.keys[i] });
    }
  for (const f of chart.forks)
    for (let i = 1; i < f.keysB.length; i++) edges.push({ a: f.keysB[i - 1], b: f.keysB[i] });
  for (const group of chart.groups)
    for (const g of group.glyphs)
      if (edges.some(({ a, b }) => rectangleTouchesSegment(g.x, g.y, g.size * 0.52 + 0.12, a, b)))
        failures++;
  return failures;
}
