import type { Vec, Keyframe } from './types';
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec, b: Vec, u: number): Vec => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u,
});
export function position(keys: Keyframe[], t: number): Vec {
  if (!keys.length) return { x: 0, y: 0 };
  if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y };
  if (t >= keys.at(-1)!.t) return { x: keys.at(-1)!.x, y: keys.at(-1)!.y };
  let lo = 0,
    hi = keys.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (keys[m].t <= t) lo = m;
    else hi = m;
  }
  return lerp(keys[lo], keys[hi], (t - keys[lo].t) / (keys[hi].t - keys[lo].t));
}
export function pointSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  if (l < 1e-12) return distance(p, a);
  return distance(p, lerp(a, b, clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l, 0, 1)));
}
export function reflect(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  if (l < 1e-9) return { x: 2 * a.x - p.x, y: p.y };
  const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l,
    q = { x: a.x + dx * u, y: a.y + dy * u };
  return { x: 2 * q.x - p.x, y: 2 * q.y - p.y };
}
export function rectangleTouchesSegment(
  cx: number,
  cy: number,
  half: number,
  a: Vec,
  b: Vec,
): boolean {
  const minX = cx - half,
    maxX = cx + half,
    minY = cy - half,
    maxY = cy + half;
  let lo = 0,
    hi = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) lo = Math.max(lo, r);
      else hi = Math.min(hi, r);
      if (lo > hi) return false;
    }
  }
  return true;
}
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(value: string): string {
  let a = 14695981039346656037n;
  for (let i = 0; i < value.length; i++) {
    a ^= BigInt(value.charCodeAt(i));
    a = BigInt.asUintN(64, a * 1099511628211n);
  }
  return a.toString(16).padStart(16, '0');
}
export function chartRevision(chart: unknown): string {
  const clean = { ...(chart as Record<string, unknown>), revision: '', warnings: [] };
  const ordered = (value: any): any =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return hash(JSON.stringify(ordered(clean)));
}
