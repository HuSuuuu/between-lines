import type { Chart, Note, Vec, Result } from './types';
import { position, clamp, forkDecisionEnd } from './geometry';
export type Judgment = {
  id: string;
  kind: Note['kind'];
  grade: 'PERFECT' | 'GOOD' | 'MISS';
  t: number;
  offset: number;
  track: 0 | 1;
};
export class Engine {
  readonly events: Note[];
  readonly keys: Chart['tracks'];
  judged = new Map<string, Judgment>();
  choices = new Map<string, 'A' | 'B'>();
  combo = 0;
  best = 0;
  extras = 0;
  signals: Judgment[] = [];
  constructor(
    readonly chart: Chart,
    readonly difficulty = 'standard',
  ) {
    this.keys = chart.tracks.map((t) => ({ id: t.id, keys: t.keys.map((k) => ({ ...k })) }));
    for (const fork of chart.forks) {
      const keys = this.keys[fork.track].keys;
      for (const key of fork.keysA) {
        if (!keys.some((k) => Math.abs(k.t - key.t) < 1e-8)) keys.push({ ...key });
      }
      keys.sort((a, b) => a.t - b.t);
    }
    this.events =
      difficulty === 'basic'
        ? chart.events
            .filter(
              (e, i, a) =>
                e.kind === 'swipe' ||
                !(i % 2 === 1 && e.t - a[i - 1].t < 0.32 && a[i + 1]?.t - e.t < 0.32),
            )
            .map((e) => ({ ...e, kind: e.kind === 'double' ? 'tap' : e.kind }))
        : chart.events.map((e) => ({ ...e }));
  }
  get goodWindow() {
    return this.difficulty === 'basic' ? 0.22 : 0.18;
  }
  get perfectWindow() {
    return this.difficulty === 'basic' ? 0.105 : 0.085;
  }
  active(t: number) {
    return this.chart.duets.some((d) => t >= d.start && t < d.end);
  }
  ball(track: 0 | 1, t: number): Vec {
    return position(this.keys.find((k) => k.id === track)!.keys, t);
  }
  upcoming(count = 3, t = -Infinity): Note[] {
    return this.events
      .filter((e) => !this.judged.has(e.id) && e.t >= t - this.goodWindow)
      .slice(0, count);
  }
  candidate(t: number, expectedId?: string): Note | undefined {
    return this.events
      .filter(
        (e) =>
          !this.judged.has(e.id) &&
          (!expectedId || expectedId === e.id) &&
          Math.abs(e.t - t) <= this.goodWindow + (e.kind === 'swipe' ? 0.04 : 0) &&
          (e.kind !== 'swipe' ||
            t <= forkDecisionEnd(this.chart.forks.find((f) => f.eventId === e.id)!)),
      )
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  }
  tick(t: number, auto = false) {
    for (const e of this.events) {
      if (this.judged.has(e.id)) continue;
      if (auto && t >= e.t) this.commit(e, 'PERFECT', e.t, 0, e.kind === 'swipe' ? 'A' : undefined);
      else if (
        t >
        (e.kind === 'swipe'
          ? forkDecisionEnd(this.chart.forks.find((f) => f.eventId === e.id)!)
          : e.t + this.goodWindow)
      )
        this.commit(e, 'MISS', e.t + this.goodWindow, this.goodWindow);
    }
  }
  hit(
    t: number,
    kind: 'tap' | 'double' | 'swipe',
    other?: number,
    direction?: Note['direction'],
    expectedId?: string,
  ): Judgment | undefined {
    const e = this.candidate(t, expectedId);
    if (!e || (expectedId && expectedId !== e.id)) {
      return undefined;
    }
    if (e.kind !== kind) return undefined;
    let offset = t - e.t,
      correct = true,
      choice: 'A' | 'B' | undefined;
    if (kind === 'double') {
      if (
        other === undefined ||
        Math.abs(t - other) > 0.08 ||
        Math.abs(other - e.t) > this.goodWindow
      )
        return undefined;
      const first = other - e.t;
      if (Math.abs(first) > Math.abs(offset)) offset = first;
    }
    if (kind === 'swipe') {
      const f = this.chart.forks.find((f) => f.eventId === e.id);
      if (!f) return undefined;
      choice = direction === f.directionA ? 'A' : direction === f.directionB ? 'B' : undefined;
      correct = !!choice;
      if (t > forkDecisionEnd(f)) correct = false;
    }
    return this.commit(
      e,
      correct ? (Math.abs(offset) <= this.perfectWindow ? 'PERFECT' : 'GOOD') : 'MISS',
      t,
      offset,
      choice,
    );
  }
  commit(e: Note, grade: Judgment['grade'], t: number, offset: number, choice?: 'A' | 'B') {
    if (this.judged.has(e.id)) return this.judged.get(e.id)!;
    if (choice && grade !== 'MISS') {
      this.choices.set(e.id, choice);
      if (choice === 'B') {
        const f = this.chart.forks.find((f) => f.eventId === e.id)!;
        for (const p of f.keysB) {
          const q = this.keys[f.track].keys.find((k) => Math.abs(k.t - p.t) < 1e-8);
          if (q) {
            q.x = p.x;
            q.y = p.y;
          }
        }
      }
    }
    const result: Judgment = { id: e.id, kind: e.kind, grade, t, offset, track: e.track };
    this.judged.set(e.id, result);
    this.signals.push(result);
    if (grade === 'MISS') this.combo = 0;
    else {
      this.combo++;
      this.best = Math.max(this.best, this.combo);
    }
    return result;
  }
  score() {
    let n = 0;
    for (const j of this.judged.values())
      n += j.grade === 'PERFECT' ? 1 : j.grade === 'GOOD' ? 0.75 : 0;
    return Math.round(clamp(n / Math.max(1, this.events.length) - this.extras * 0.02, 0, 1) * 1000);
  }
  result(assisted = false, practice = false): Result {
    const judgments = [...this.judged.values()],
      hits = judgments.filter((j) => j.grade !== 'MISS'),
      perfect = hits.filter((j) => j.grade === 'PERFECT').length,
      score = this.score();
    return {
      songId: this.chart.songId,
      chartId: this.chart.id,
      revision: this.chart.revision,
      difficulty: this.difficulty,
      score,
      grade:
        score === 1000 ? 'SSS' : score >= 950 ? 'S' : score >= 850 ? 'A' : score >= 700 ? 'B' : 'C',
      perfect,
      good: hits.length - perfect,
      miss: this.events.length - hits.length,
      extras: this.extras,
      combo: this.best,
      total: this.events.length,
      just: hits.filter((j) => Math.abs(j.offset) <= 0.025).length,
      accuracy: Math.round((hits.length / Math.max(1, this.events.length)) * 1000) / 10,
      meanError: hits.length
        ? Math.round(hits.reduce((s, j) => s + Math.abs(j.offset) * 1000, 0) / hits.length)
        : null,
      assisted,
      practice,
      date: new Date().toISOString(),
      routes: this.keys.map((k) => k.keys.map((p) => ({ x: p.x, y: p.y }))),
    };
  }
}
