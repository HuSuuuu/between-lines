import type { Settings } from './types';
import { clamp } from './geometry';
export class MusicClock {
  context: AudioContext;
  music: GainNode;
  hits: GainNode;
  master: GainNode;
  buffer?: AudioBuffer;
  source?: AudioBufferSourceNode;
  origin = 0;
  paused = 0;
  end = 0;
  running = false;
  settings: Settings;
  noise: AudioBuffer;
  decodeToken = 0;
  operation = 0;
  private decodedBlob?: Blob;
  private decoding?: Promise<AudioBuffer>;
  constructor(settings: Settings) {
    this.settings = { ...settings };
    const Audio = window.AudioContext || (window as any).webkitAudioContext;
    this.context = new Audio({ latencyHint: 'interactive' });
    this.music = this.context.createGain();
    this.hits = this.context.createGain();
    this.master = this.context.createGain();
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.06;
    this.music.connect(this.master);
    this.hits.connect(this.master);
    this.master.gain.value = 0.7;
    this.master.connect(limiter);
    limiter.connect(this.context.destination);
    this.apply(settings);
    this.noise = this.context.createBuffer(
      1,
      Math.ceil(this.context.sampleRate * 0.045),
      this.context.sampleRate,
    );
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  apply(s: Settings) {
    this.settings = { ...s };
    this.music.gain.setValueAtTime(s.music / 100, this.context.currentTime);
    this.hits.gain.setValueAtTime(s.hits / 100, this.context.currentTime);
  }
  async decode(blob: Blob) {
    if (blob === this.decodedBlob && this.decoding) return this.decoding;
    const token = ++this.decodeToken;
    this.decodedBlob = blob;
    const pending = blob.arrayBuffer().then((data) => this.context.decodeAudioData(data));
    this.decoding = pending;
    try {
      const buffer = await pending;
      if (token === this.decodeToken) this.buffer = buffer;
      return buffer;
    } catch (error) {
      if (token === this.decodeToken) {
        this.decodedBlob = undefined;
        this.decoding = undefined;
      }
      throw error;
    }
  }
  async play(start = 0, end = this.buffer?.duration || 0, countIn = 0.8) {
    const operation = ++this.operation;
    await this.context.resume();
    if (operation !== this.operation) return false;
    if (!this.buffer) throw Error('音乐尚未载入');
    this.stopSource();
    const now = this.context.currentTime;
    this.origin = now + countIn - start;
    this.end = Math.min(end, this.buffer.duration);
    this.paused = start - countIn;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.music);
    source.start(now + countIn, Math.max(0, start), Math.max(0.001, this.end - start));
    this.source = source;
    this.running = true;
    this.music.gain.setValueAtTime(this.settings.music / 100, now);
    source.onended = () => source.disconnect();
    return true;
  }
  heard(stamp = performance.now()) {
    let t = this.context.currentTime;
    const ts = this.context.getOutputTimestamp?.(),
      ct = ts?.contextTime,
      pt = ts?.performanceTime;
    if (
      ct !== undefined &&
      pt !== undefined &&
      ct > 0 &&
      pt > 0 &&
      Math.abs(performance.now() - pt) < 1000
    )
      t = ct + (stamp - pt) / 1000;
    else t -= (this.context.baseLatency || 0) + (this.context.outputLatency || 0);
    return Math.min(this.context.currentTime, Math.max(0, t));
  }
  time(stamp?: number) {
    return this.running ? this.heard(stamp) - this.origin : this.paused;
  }
  judgedTime(stamp?: number) {
    return this.time(stamp) + this.settings.offset / 1000;
  }
  pause() {
    this.operation++;
    if (!this.running) return;
    this.paused = this.time();
    this.running = false;
    this.stopSource();
  }
  resume() {
    return this.play(Math.max(0, this.paused), this.end, 0);
  }
  stopSource() {
    if (this.source) {
      try {
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = undefined;
    }
  }
  stop() {
    this.operation++;
    this.running = false;
    this.stopSource();
  }
  feedback(double = false, miss = false) {
    const t = this.context.currentTime,
      gain = this.context.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(miss ? 0.09 : double ? 0.24 : 0.17, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    gain.connect(this.hits);
    const osc = this.context.createOscillator();
    osc.type = miss ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(miss ? 120 : double ? 1500 : 1100, t);
    osc.frequency.exponentialRampToValueAtTime(miss ? 80 : 420, t + 0.045);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    if (!miss) {
      const noise = this.context.createBufferSource(),
        ng = this.context.createGain();
      noise.buffer = this.noise;
      ng.gain.value = double ? 0.17 : 0.1;
      noise.connect(ng);
      ng.connect(this.hits);
      noise.start(t);
      noise.onended = () => {
        noise.disconnect();
        ng.disconnect();
      };
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setValueAtTime((this.settings.music / 100) * (double ? 0.82 : 0.9), t);
      this.music.gain.linearRampToValueAtTime(this.settings.music / 100, t + 0.045);
    }
    if (this.settings.haptics && !miss) navigator.vibrate?.(double ? 12 : 6);
  }
  waveform(bins = 160) {
    if (!this.buffer) return [];
    const channels = this.buffer.numberOfChannels,
      length = this.buffer.length,
      step = Math.ceil(length / bins),
      out = [];
    for (let i = 0; i < bins; i++) {
      let peak = 0;
      for (let ch = 0; ch < channels; ch++) {
        const data = this.buffer.getChannelData(ch);
        for (
          let j = i * step;
          j < Math.min(length, (i + 1) * step);
          j += Math.max(1, Math.floor(step / 128))
        )
          peak = Math.max(peak, Math.abs(data[j]));
      }
      out.push(clamp(peak, 0, 1));
    }
    return out;
  }
}
