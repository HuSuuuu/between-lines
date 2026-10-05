import type { Chart, Vec, Settings, TextGroup } from './types';
import { Engine, type Judgment } from './engine';
import { position, lerp, clamp, distance } from './geometry';
import { readingScale, glyphRasterSize } from './reading';
type Flash = { at: number; points: Vec[]; grade: string; offset: number; double: boolean };
export class Renderer {
  ctx: CanvasRenderingContext2D;
  unit = 40;
  width = 0;
  height = 0;
  dpr = 1;
  camera: Vec = { x: 0, y: 0 };
  flashes: Flash[] = [];
  contactAt = -99;
  cache = new Map<string, HTMLCanvasElement>();
  cacheBytes = 0;
  lastStamp = performance.now();
  pendingDouble?: string;
  readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  rasterCreated = 0;
  cloudIndex = new Map<string, TextGroup[]>();
  cloudEntered = new Map<string, number>();
  cloudOverflow: TextGroup[] = [];
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly engine: Engine,
    readonly settings: Settings,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.camera = engine.ball(0, 0);
    for (const group of engine.chart.groups) {
      const left = Math.floor(Math.min(...group.glyphs.map((g) => g.x - g.size)) / 8);
      const right = Math.floor(Math.max(...group.glyphs.map((g) => g.x + g.size)) / 8);
      const top = Math.floor(Math.min(...group.glyphs.map((g) => g.y - g.size)) / 8);
      const bottom = Math.floor(Math.max(...group.glyphs.map((g) => g.y + g.size)) / 8);
      if ((right - left + 1) * (bottom - top + 1) > 128) {
        this.cloudOverflow.push(group);
        continue;
      }
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const key = x + ':' + y,
            list = this.cloudIndex.get(key) || [];
          list.push(group);
          this.cloudIndex.set(key, list);
        }
    }
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const rotated = document.body.dataset.rotated === 'true';
    const width = rotated ? rect.height : rect.width,
      height = rotated ? rect.width : rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (!width || !height || (width === this.width && height === this.height && dpr === this.dpr))
      return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.unit = Math.min(this.width, this.height) / 12;
    this.cache.clear();
    this.cacheBytes = 0;
  }
  world(p: Vec): Vec {
    return {
      x: this.width / 2 + (p.x - this.camera.x) * this.unit,
      y: this.height / 2 + (p.y - this.camera.y) * this.unit,
    };
  }
  feedback(j: Judgment, stamp = performance.now()) {
    const points = [this.engine.ball(j.track, this.engine.events.find((e) => e.id === j.id)!.t)];
    if (j.kind === 'double' && this.engine.active(this.engine.events.find((e) => e.id === j.id)!.t))
      points.push(
        this.engine.ball((1 - j.track) as 0 | 1, this.engine.events.find((e) => e.id === j.id)!.t),
      );
    this.flashes.push({
      at: stamp,
      points,
      grade: j.grade,
      offset: j.offset,
      double: j.kind === 'double',
    });
  }
  draw(t: number, stamp = performance.now()) {
    const c = this.ctx;
    if (!this.width || !this.height) return;
    const dt = Math.min(0.06, (stamp - this.lastStamp) / 1000);
    this.lastStamp = stamp;
    const a = this.engine.ball(0, t),
      active = this.engine.active(t),
      b = this.engine.ball(1, t),
      center = active ? lerp(a, b, 0.5) : a;
    const next = this.engine.upcoming(3, t),
      lead = next[0] ? this.engine.ball(next[0].track, next[0].t) : center;
    const aim = lerp(center, lead, 0.16);
    this.camera = lerp(this.camera, aim, 1 - Math.exp(-dt * 11));
    const spread = active ? distance(a, b) : 0;
    const targetUnit = readingScale(Math.min(this.width, this.height), spread);
    this.unit += (targetUnit - this.unit) * (1 - Math.exp(-dt * 6));
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, this.width, this.height);
    const visible = new Set<TextGroup>(this.cloudOverflow);
    const halfW = this.width / this.unit / 2 + 2,
      halfH = this.height / this.unit / 2 + 2;
    for (
      let y = Math.floor((this.camera.y - halfH) / 8);
      y <= Math.floor((this.camera.y + halfH) / 8);
      y++
    )
      for (
        let x = Math.floor((this.camera.x - halfW) / 8);
        x <= Math.floor((this.camera.x + halfW) / 8);
        x++
      )
        for (const group of this.cloudIndex.get(x + ':' + y) || []) visible.add(group);
    this.text([...visible], stamp);
    if (this.settings.effects && !this.reduced.matches) {
      for (const track of active ? ([0, 1] as const) : ([0] as const)) {
        c.beginPath();
        for (let i = 5; i >= 0; i--) {
          const p = this.world(this.engine.ball(track, Math.max(0, t - i * 0.024)));
          i === 5 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y);
        }
        c.strokeStyle = '#bcc2c6';
        c.lineWidth = 1.2;
        c.globalAlpha = 0.3;
        c.lineCap = 'round';
        c.stroke();
        c.globalAlpha = 1;
      }
    }
    // A shared ordered preview is reinforced by spatial nodes on the continuous route.
    const until = Math.max(t + 2, next.at(-1)?.t || t + 2);
    for (const track of this.engine.keys) {
      if (
        track.id === 1 &&
        !this.engine.chart.duets.some((d) => d.end > t - 0.4 && d.start < until)
      )
        continue;
      const keys = track.keys.filter((k) => k.t >= t - 0.6 && k.t <= until);
      const from = Math.max(0, t - 0.6),
        last = Math.min(this.engine.chart.duration, until);
      const ps = [this.engine.ball(track.id, from), ...keys, this.engine.ball(track.id, last)];
      c.beginPath();
      ps.forEach((p, i) => {
        const q = this.world(p);
        i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y);
      });
      c.lineJoin = 'round';
      c.strokeStyle = '#ffffff';
      c.lineWidth = 4;
      c.stroke();
      c.strokeStyle = track.id === 0 ? '#343b40' : '#626e78';
      c.lineWidth = track.id === 0 ? 1.1 : 1;
      c.setLineDash(track.id === 1 ? [3, 3] : []);
      c.stroke();
      c.setLineDash([]);
    }
    for (const fork of this.engine.chart.forks) {
      if (fork.start < t - 0.18 || fork.start > until || this.engine.choices.has(fork.eventId))
        continue;
      c.beginPath();
      fork.keysB.forEach((p, i) => {
        const q = this.world(p);
        i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y);
      });
      c.strokeStyle = '#bbb';
      c.lineWidth = 0.75;
      c.setLineDash([1, 4]);
      c.stroke();
      c.setLineDash([]);
    }
    next.forEach((event, i) => {
      const p = this.world(this.engine.ball(event.track, event.t));
      const points = [p];
      if (event.kind === 'double' && this.engine.active(event.t))
        points.push(this.world(this.engine.ball((1 - event.track) as 0 | 1, event.t)));
      const remaining = event.t - t,
        primary = i === 0;
      c.globalAlpha = primary ? 1 : i === 1 ? 0.8 : 0.6;
      if (points.length === 2) {
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(points[1].x, points[1].y);
        c.strokeStyle = '#b9c0c5';
        c.lineWidth = 0.65;
        c.setLineDash([2, 5]);
        c.stroke();
        c.setLineDash([]);
      }
      points.forEach((point) => {
        c.strokeStyle = primary ? '#333' : '#777';
        c.lineWidth = primary ? 1.1 : 0.8;
        this.pearl(
          point.x,
          point.y,
          event.kind === 'double' ? 3.6 : event.kind === 'swipe' ? 4 : 2.8,
        );
        if (primary && remaining > 0 && remaining < 1.2) {
          const phase = clamp(remaining / 1.2, 0, 1);
          c.beginPath();
          c.arc(point.x, point.y, 4.5 + phase * 17, -Math.PI / 2, Math.PI * 1.5);
          c.strokeStyle = '#a2abb2';
          c.lineWidth = 0.7;
          c.stroke();
        }
      });
      const badge = points.length === 2 ? lerp(p, points[1], 0.5) : { x: p.x, y: p.y - 18 };
      c.fillStyle = '#fff';
      c.fillRect(badge.x - 15, badge.y - 8, 30, 16);
      c.fillStyle = primary ? '#25282a' : '#7a8085';
      c.font = '600 11px Arial';
      c.textAlign = 'center';
      if (event.kind === 'double') {
        c.fillText(this.pendingDouble === event.id ? '●·' : '●○', badge.x, badge.y + 3);
      } else if (event.kind === 'swipe') {
        const f = this.engine.chart.forks.find((f) => f.eventId === event.id);
        const arrows = { left: '←', right: '→', up: '↑', down: '↓' };
        c.fillText(f ? arrows[f.directionA!] + arrows[f.directionB!] : '↔', badge.x, badge.y + 3);
      } else c.fillText(String(i + 1), badge.x, badge.y + 3);
      c.globalAlpha = 1;
    });
    const focus = next[0]?.track || 0,
      paired = next[0]?.kind === 'double';
    this.ball(a, paired || focus === 0, stamp, 0);
    if (active) this.ball(b, paired || focus === 1, stamp, 1);
    const announced = this.engine.chart.duets.find(
      (d) =>
        (d.start > t && d.start - t <= 120 / this.engine.chart.tempo) ||
        (d.end > t && d.end - t <= 120 / this.engine.chart.tempo),
    );
    if (announced) {
      const p = this.world(center);
      c.fillStyle = '#777';
      c.font = '10px Arial';
      c.textAlign = 'center';
      c.fillText(announced.start > t ? '●  ●' : '●', p.x, p.y + 24);
    }
    this.flashes = this.flashes.filter((f) => stamp - f.at < 330);
    for (const f of this.flashes) {
      const age = (stamp - f.at) / 330;
      if (!this.settings.effects || this.reduced.matches) continue;
      if (f.double && f.points.length === 2) {
        const a = this.world(f.points[0]),
          b = this.world(f.points[1]);
        c.globalAlpha = Math.pow(1 - age, 2) * 0.8;
        c.strokeStyle = f.grade === 'MISS' ? '#555' : '#8f9ba4';
        c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
      for (const point of f.points) {
        const p = this.world(point);
        c.globalAlpha = Math.pow(1 - age, 2.4) * 0.95;
        const glow = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 28 + age * 12);
        glow.addColorStop(0, 'rgba(255,255,255,.98)');
        glow.addColorStop(0.3, 'rgba(224,228,231,.7)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = glow;
        c.beginPath();
        c.arc(p.x, p.y, 28 + age * 12, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = f.grade === 'MISS' ? '#444' : '#9fa7ad';
        c.lineWidth = 0.6;
        c.beginPath();
        c.arc(p.x, p.y, 5 + (1 - Math.pow(1 - age, 4)) * 19, 0, Math.PI * 2);
        c.stroke();
        if (age < 0.4 && f.grade !== 'MISS') {
          c.strokeStyle = '#9da7ae';
          c.lineWidth = 1;
          for (let i = 0; i < 4; i++) {
            const angle = Math.PI / 4 + (i * Math.PI) / 2,
              r = 7 + age * 25;
            c.beginPath();
            c.moveTo(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r);
            c.lineTo(p.x + Math.cos(angle) * (r + 5), p.y + Math.sin(angle) * (r + 5));
            c.stroke();
          }
        }
        if (age < 0.7 && point === f.points[0]) {
          c.fillStyle = '#333';
          c.font = '600 9px Arial';
          c.textAlign = 'center';
          c.fillText(
            f.grade === 'MISS' ? 'MISS' : Math.abs(f.offset) <= 0.025 ? 'JUST' : f.grade,
            p.x,
            p.y - 19,
          );
          if (f.grade !== 'MISS') {
            c.font = '8px monospace';
            c.fillStyle = '#6a747c';
            c.fillText(
              (f.offset >= 0 ? '+' : '') + Math.round(f.offset * 1000) + ' ms',
              p.x,
              p.y - 9,
            );
          }
        }
      }
    }
    c.globalAlpha = 1;
  }
  pearl(x: number, y: number, r: number) {
    const c = this.ctx;
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  ball(point: Vec, focus: boolean, stamp: number, track: 0 | 1) {
    const p = this.world(point),
      c = this.ctx;
    const g = c.createRadialGradient(p.x - 1, p.y - 1, 0, p.x, p.y, 10);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.38, '#f0f0f0');
    g.addColorStop(0.62, focus ? '#bfc5c9' : '#eee');
    g.addColorStop(1, '#ffffff00');
    c.fillStyle = g;
    c.beginPath();
    c.arc(p.x, p.y, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = track === 0 ? '#161616' : '#fff';
    c.strokeStyle = track === 0 ? '#fff' : '#333';
    c.lineWidth = focus ? 1 : 0.8;
    c.beginPath();
    let hit: Flash | undefined;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      if (
        f.grade !== 'MISS' &&
        stamp - f.at < 150 &&
        f.points.some((q) => distance(q, point) < 0.4)
      ) {
        hit = f;
        break;
      }
    }
    const impact =
      hit && this.settings.effects && !this.reduced.matches
        ? Math.sin(((stamp - hit.at) / 150) * Math.PI) * 1.7
        : 0;
    c.arc(p.x, p.y, 4.1 + impact, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (this.settings.effects && !this.reduced.matches && stamp - this.contactAt < 85) {
      c.strokeStyle = '#a4a9ad';
      c.lineWidth = 0.65;
      c.beginPath();
      c.arc(p.x, p.y, 6 + (stamp - this.contactAt) / 25, 0, Math.PI * 2);
      c.stroke();
    }
  }
  text(groups: TextGroup[], stamp = performance.now()) {
    const c = this.ctx;
    const motion = this.settings.effects && !this.reduced.matches;
    for (const group of groups) {
      if (!this.cloudEntered.has(group.id)) this.cloudEntered.set(group.id, stamp);
      const age = Math.min(1, (stamp - this.cloudEntered.get(group.id)!) / 680);
      const ink = group.role === 'fill' ? (group.glyphs[0]?.size <= 0.56 ? 0.58 : 0.8) : 1;
      c.globalAlpha = ink * (motion ? 0.35 + 0.65 * (1 - Math.pow(1 - age, 4)) : 1);
      for (const g of group.glyphs) {
        const p = this.world(g),
          px = Math.max(12, g.size * this.unit),
          half = px * 0.8;
        if (p.x < -half || p.x > this.width + half || p.y < -half || p.y > this.height + half)
          continue;
        const pixels = glyphRasterSize(g.size, Math.min(this.width, this.height), this.dpr),
          key = g.text + ':' + pixels;
        let tile = this.cache.get(key);
        if (!tile) {
          tile = document.createElement('canvas');
          tile.width = Math.ceil(pixels * 1.5);
          tile.height = Math.ceil(pixels * 1.5);
          const tc = tile.getContext('2d')!;
          tc.font = '400 ' + pixels + 'px "Noto Serif SC", serif';
          tc.textAlign = 'center';
          tc.textBaseline = 'middle';
          tc.fillStyle = '#171717';
          tc.fillText(g.text, tile.width / 2, tile.height / 2);
          this.rasterCreated++;
          this.cache.set(key, tile);
          this.cacheBytes += tile.width * tile.height * 4;
        }
        const scale = px / pixels,
          w = tile.width * scale,
          h = tile.height * scale;
        c.drawImage(
          tile,
          Math.round((p.x - w / 2) * this.dpr) / this.dpr,
          Math.round((p.y - h / 2) * this.dpr) / this.dpr,
          w,
          h,
        );
      }
    }
    c.globalAlpha = 1;
    while (this.cacheBytes > 24 * 1024 * 1024 && this.cache.size) {
      const key = this.cache.keys().next().value!,
        tile = this.cache.get(key)!;
      this.cacheBytes -= tile.width * tile.height * 4;
      this.cache.delete(key);
    }
  }
}
const posterTokens = new WeakMap<HTMLCanvasElement, number>();
export function drawPoster(canvas: HTMLCanvasElement, chart: Chart) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const c = canvas.getContext('2d')!;
  const hero = chart.groups.find((g) => g.role === 'hero');
  const center = hero
    ? {
        x: hero.glyphs.reduce((n, g) => n + g.x, 0) / hero.glyphs.length,
        y: hero.glyphs.reduce((n, g) => n + g.y, 0) / hero.glyphs.length,
      }
    : chart.chapters[0].anchor;
  const span = hero
    ? Math.max(...hero.glyphs.map((g) => g.x + g.size / 2)) -
      Math.min(...hero.glyphs.map((g) => g.x - g.size / 2))
    : 10;
  const scale = rect.width / Math.max(13.5, span + 1.5);
  const px = (x: number) => rect.width / 2 + (x - center.x) * scale;
  const py = (y: number) => rect.height / 2 + (y - center.y) * scale;
  const sprites: {
    image: HTMLCanvasElement;
    x: number;
    y: number;
    w: number;
    h: number;
    alpha: number;
    delay: number;
  }[] = [];
  for (const group of chart.groups) {
    const glyphs = group.glyphs.filter(
      (g) =>
        px(g.x) > -g.size * scale &&
        px(g.x) < rect.width + g.size * scale &&
        py(g.y) > -g.size * scale &&
        py(g.y) < rect.height + g.size * scale,
    );
    if (!glyphs.length) continue;
    const left = Math.min(...glyphs.map((g) => px(g.x) - g.size * scale * 0.72));
    const top = Math.min(...glyphs.map((g) => py(g.y) - g.size * scale * 0.72));
    const right = Math.max(...glyphs.map((g) => px(g.x) + g.size * scale * 0.72));
    const bottom = Math.max(...glyphs.map((g) => py(g.y) + g.size * scale * 0.72));
    const image = document.createElement('canvas');
    image.width = Math.ceil((right - left) * dpr);
    image.height = Math.ceil((bottom - top) * dpr);
    const tc = image.getContext('2d')!;
    tc.scale(dpr, dpr);
    tc.textAlign = 'center';
    tc.textBaseline = 'middle';
    tc.fillStyle = '#171717';
    for (const g of glyphs) {
      tc.font = '400 ' + g.size * scale + 'px "Noto Serif SC", serif';
      tc.fillText(g.text, px(g.x) - left, py(g.y) - top);
    }
    sprites.push({
      image,
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
      alpha: group.role === 'fill' ? (glyphs[0].size <= 0.56 ? 0.52 : 0.8) : 1,
      delay: group.role === 'hero' ? 0 : (sprites.length % 19) * 13,
    });
  }
  const token = (posterTokens.get(canvas) || 0) + 1;
  posterTokens.set(canvas, token);
  const start = performance.now(),
    reduced = document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(_stamp: number) {
    const now = performance.now();
    if (posterTokens.get(canvas) !== token || !canvas.isConnected || !canvas.clientWidth) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, rect.width, rect.height);
    for (const sprite of sprites) {
      const age = reduced ? 1 : clamp((now - start - sprite.delay) / 820, 0, 1),
        ease = 1 - Math.pow(1 - age, 5);
      c.globalAlpha = sprite.alpha * (0.72 + 0.28 * ease);
      c.drawImage(sprite.image, sprite.x, sprite.y + (1 - ease) * 13, sprite.w, sprite.h);
    }
    c.globalAlpha = 0.45;
    c.beginPath();
    chart.tracks[0].keys.forEach((p, i) =>
      i ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y)),
    );
    c.strokeStyle = '#777';
    c.lineWidth = 0.55;
    c.stroke();
    c.globalAlpha = 1;
    if (!reduced && now - start < 1100) requestAnimationFrame(frame);
  }
  frame(start);
}
