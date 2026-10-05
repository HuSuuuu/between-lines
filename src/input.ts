import type { Note } from './types';
import type { Engine, Judgment } from './engine';
import { distance } from './geometry';
type Contact = { x: number; y: number; t: number; note?: Note; swiped: boolean };
export class PlayInput {
  lastDeliveryMs = 0;
  contacts = new Map<number, Contact>();
  chord?: { id: string; t: number; pointer: number };
  held = new Set<string>();
  abort = new AbortController();
  constructor(
    readonly field: HTMLElement,
    readonly engine: Engine,
    readonly time: (stamp?: number) => number,
    readonly enabled: () => boolean,
    readonly judgment: (j: Judgment) => void,
    readonly contact: () => void,
    readonly rotated: () => boolean,
    readonly chordChanged?: (note?: Note) => void,
  ) {
    const opts = { signal: this.abort.signal };
    field.addEventListener('pointerdown', (e) => this.down(e), opts);
    field.addEventListener('pointermove', (e) => this.move(e), opts);
    field.addEventListener('pointerup', (e) => this.up(e.pointerId), opts);
    field.addEventListener('pointercancel', (e) => this.up(e.pointerId), opts);
    field.addEventListener('lostpointercapture', (e) => this.up(e.pointerId), opts);
    document.addEventListener('keydown', (e) => this.key(e), opts);
    document.addEventListener(
      'keyup',
      (e) => {
        this.held.delete(e.code);
        this.up(this.keyId(e.code));
      },
      opts,
    );
  }
  keyId(code: string) {
    return code === 'KeyF' ? -1 : code === 'KeyJ' ? -2 : -3;
  }
  stamp(e: PointerEvent | KeyboardEvent) {
    const now = performance.now(),
      stamp =
        Number.isFinite(e.timeStamp) && Math.abs(e.timeStamp - now) < 1000 ? e.timeStamp : now;
    this.lastDeliveryMs = Math.max(0, now - stamp);
    return stamp;
  }
  logical(x: number, y: number) {
    return this.rotated() ? { x: y, y: -x } : { x, y };
  }
  press(pointer: number, t: number, x = 0, y = 0) {
    if (!this.enabled() || this.contacts.has(pointer)) return;
    this.contact();
    const heldChord = this.chord;
    if (
      heldChord &&
      heldChord.pointer !== pointer &&
      Math.abs(t - heldChord.t) <= 0.08 &&
      (this.contacts.has(heldChord.pointer) || (pointer < 0 && heldChord.pointer < 0))
    ) {
      const result = this.engine.hit(t, 'double', heldChord.t, undefined, heldChord.id);
      if (result) {
        this.contacts.set(pointer, { x, y, t, swiped: false });
        this.chord = undefined;
        this.chordChanged?.();
        this.judgment(result);
        return;
      }
    }
    const note = this.engine.candidate(t);
    this.contacts.set(pointer, { x, y, t, note, swiped: false });
    if (!note) {
      if (
        t > 0 &&
        this.engine.upcoming(1, t)[0] &&
        Math.abs(this.engine.upcoming(1, t)[0].t - t) < 0.5
      )
        this.engine.extras++;
      return;
    }
    if (note.kind === 'swipe') return;
    if (note.kind === 'double') {
      if (
        this.chord &&
        this.chord.id === note.id &&
        this.chord.pointer !== pointer &&
        (this.contacts.has(this.chord.pointer) || (pointer < 0 && this.chord.pointer < 0)) &&
        Math.abs(t - this.chord.t) <= 0.08
      ) {
        const j = this.engine.hit(t, 'double', this.chord.t, undefined, note.id);
        this.chord = undefined;
        this.chordChanged?.();
        if (j) this.judgment(j);
      } else {
        this.chord = { id: note.id, t, pointer };
        this.chordChanged?.(note);
      }
      return;
    }
    const j = this.engine.hit(t, 'tap');
    if (j) this.judgment(j);
  }
  down(e: PointerEvent) {
    if (e.button !== 0 || !this.enabled()) return;
    e.preventDefault();
    try {
      this.field.setPointerCapture(e.pointerId);
    } catch {}
    const p = this.logical(e.clientX, e.clientY);
    this.press(e.pointerId, this.time(this.stamp(e)), p.x, p.y);
  }
  move(e: PointerEvent) {
    const c = this.contacts.get(e.pointerId);
    if (!c || c.swiped || c.note?.kind !== 'swipe' || !this.enabled()) return;
    const p = this.logical(e.clientX, e.clientY);
    if (distance(c, p) < 12) return;
    c.swiped = true;
    const dx = p.x - c.x,
      dy = p.y - c.y,
      direction: Note['direction'] =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    const j = this.engine.hit(this.time(this.stamp(e)), 'swipe', undefined, direction, c.note.id);
    if (j) this.judgment(j);
  }
  up(pointer: number) {
    this.contacts.delete(pointer);
    if (pointer >= 0 && this.chord?.pointer === pointer) {
      this.chord = undefined;
      this.chordChanged?.();
    }
  }
  key(e: KeyboardEvent) {
    if (!this.enabled() || e.repeat || this.held.has(e.code)) return;
    const target = e.target as HTMLElement;
    if (target.matches('input,textarea,select,button')) return;
    const direction: Record<string, Note['direction']> = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
    };
    if (direction[e.code]) {
      e.preventDefault();
      this.held.add(e.code);
      let d = direction[e.code];
      if (this.rotated()) {
        const map = { left: 'down', right: 'up', up: 'left', down: 'right' } as const;
        d = map[d!];
      }
      const j = this.engine.hit(this.time(this.stamp(e)), 'swipe', undefined, d);
      if (j) this.judgment(j);
    } else if (['Space', 'Enter', 'KeyF', 'KeyJ'].includes(e.code)) {
      e.preventDefault();
      this.held.add(e.code);
      this.press(this.keyId(e.code), this.time(this.stamp(e)));
    }
  }
  clear() {
    this.contacts.clear();
    this.chord = undefined;
    this.chordChanged?.();
    this.held.clear();
  }
  destroy() {
    this.clear();
    this.abort.abort();
  }
}
