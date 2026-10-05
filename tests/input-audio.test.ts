import { describe, it, expect, vi } from 'vitest';
import { PlayInput } from '../src/input';
import { Engine } from '../src/engine';
import { generate } from '../src/generator';
import { MusicClock } from '../src/audio';
import { defaults } from '../src/types';
function harness() {
  const field = new EventTarget() as HTMLElement;
  (field as any).setPointerCapture = () => {};
  const doc = new EventTarget();
  vi.stubGlobal('document', doc);
  let time = 2;
  const chart = generate({
    id: 'input',
    songId: 'input-song',
    title: 'input',
    artist: '',
    duration: 8,
    events: [
      { id: 'double', t: 2, kind: 'double', track: 0 },
      { id: 'tap', t: 3, kind: 'tap', track: 0 },
      { id: 'fork', t: 5, kind: 'swipe', track: 0 },
      { id: 'after-fork', t: 6, kind: 'tap', track: 0 },
    ],
    lyrics: [],
    duets: [],
    seed: 20,
  });
  const engine = new Engine(chart);
  const signals: any[] = [];
  const input = new PlayInput(
    field,
    engine,
    () => time,
    () => true,
    (j) => signals.push(j),
    () => {},
    () => false,
  );
  return { input, engine, signals, setTime: (t: number) => (time = t) };
}
describe('multi-contact lifecycle', () => {
  it('judges two independent contacts once and ignores held or duplicate pointers', () => {
    const { input, engine, signals } = harness();
    input.press(1, 2);
    input.press(1, 2.01);
    expect(engine.judged.size).toBe(0);
    input.press(2, 2.025);
    expect(signals).toHaveLength(1);
    expect(signals[0].grade).toBe('PERFECT');
    input.press(3, 2.03);
    expect(signals).toHaveLength(1);
    input.destroy();
  });
  it('cancellation and release cannot leave a stale touch available for a chord', () => {
    const { input, engine } = harness();
    input.press(1, 1.99);
    input.up(1);
    input.press(2, 2.01);
    expect(engine.judged.size).toBe(0);
    input.clear();
    input.press(3, 2.06);
    expect(engine.judged.size).toBe(0);
    input.destroy();
  });
  it('supports quick distinct F and J keystrokes even across keyup, never repeat F', () => {
    const { input, engine } = harness();
    input.press(-1, 2);
    input.up(-1);
    input.press(-1, 2.015);
    expect(engine.judged.size).toBe(0);
    input.up(-1);
    input.press(-2, 2.03);
    expect(engine.judged.size).toBe(1);
    input.destroy();
  });
  it('clear on pause prevents a pre-pause finger from contributing after resume', () => {
    const { input, engine } = harness();
    input.press(1, 2);
    input.clear();
    input.press(2, 2.02);
    expect(engine.judged.size).toBe(0);
    input.press(3, 2.04);
    expect(engine.judged.size).toBe(1);
    input.destroy();
  });
});
class Param {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  threshold = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  frequency = new Param();
  buffer: any;
  type = '';
  onended?: () => void;
  connect() {}
  disconnect() {}
  start = vi.fn();
  stop = vi.fn();
}
class Audio {
  currentTime = 10;
  baseLatency = 0.02;
  outputLatency = 0.03;
  sampleRate = 16000;
  destination = {};
  state = 'running';
  lastSource?: Node;
  resume = vi.fn(async () => {});
  createGain() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createBuffer(_c: number, n: number) {
    return { getChannelData: () => new Float32Array(n) };
  }
  createBufferSource() {
    this.lastSource = new Node();
    return this.lastSource;
  }
  createOscillator() {
    return new Node();
  }
  decodeAudioData = vi.fn(async () => ({
    duration: 24,
    numberOfChannels: 1,
    length: 16000,
    getChannelData: () => new Float32Array(16000),
  }));
  getOutputTimestamp() {
    return { contextTime: this.currentTime - 0.05, performanceTime: performance.now() };
  }
}
describe('shared music time, pause and independent gains', () => {
  it('freezes position on pause, resumes the same source offset and retains full ending', async () => {
    vi.stubGlobal('window', { AudioContext: Audio });
    vi.stubGlobal('navigator', {});
    const clock = new MusicClock({ ...defaults, offset: 100 });
    await clock.decode(new Blob(['audio']));
    await clock.play(4, 24, 0.8);
    const audio = clock.context as unknown as Audio;
    expect(audio.lastSource!.start).toHaveBeenCalledWith(10.8, 4, 20);
    audio.currentTime = 16;
    const raw = clock.time(),
      judged = clock.judgedTime();
    expect(judged - raw).toBeCloseTo(0.1);
    clock.pause();
    const frozen = clock.time();
    audio.currentTime = 30;
    expect(clock.time()).toBe(frozen);
    await clock.resume();
    expect(audio.lastSource!.start).toHaveBeenCalledWith(30, frozen, 24 - frozen);
    expect(clock.end).toBe(24);
  });
  it('cancels a pending resume before it can start a ghost source', async () => {
    vi.stubGlobal('window', { AudioContext: Audio });
    const clock = new MusicClock(defaults);
    await clock.decode(new Blob(['audio']));
    const audio = clock.context as unknown as Audio;
    let allow!: () => void;
    audio.resume = vi.fn(() => new Promise<void>((resolve) => (allow = resolve)));
    const started = clock.play(0, 24, 0);
    clock.stop();
    allow();
    expect(await started).toBe(false);
    expect(audio.lastSource).toBeUndefined();
  });
  it('changes volume and hit gain independently without moving the music clock', async () => {
    vi.stubGlobal('window', { AudioContext: Audio });
    const clock = new MusicClock(defaults);
    const before = clock.time();
    clock.apply({ ...defaults, music: 25, hits: 80 });
    expect(clock.music.gain.value).toBe(0.25);
    expect(clock.hits.gain.value).toBe(0.8);
    expect(clock.time()).toBe(before);
  });
});
