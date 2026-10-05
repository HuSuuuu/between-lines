export class RuntimeReport {
  frames: number[] = [];
  intervals: number[] = [];
  inputs: number[] = [];
  previous = 0;
  reset() {
    this.frames = [];
    this.intervals = [];
    this.inputs = [];
    this.previous = 0;
  }
  frame(stamp: number, cost: number) {
    this.frames.push(cost);
    if (this.previous && stamp - this.previous < 100) this.intervals.push(stamp - this.previous);
    this.previous = stamp;
    if (this.frames.length > 2400) this.frames.shift();
    if (this.intervals.length > 2400) this.intervals.shift();
  }
  input(ms: number) {
    this.inputs.push(ms);
    if (this.inputs.length > 1000) this.inputs.shift();
  }
  summary() {
    if (!this.frames.length) return '完成一次演奏后显示。';
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const p95 = (a: number[]) =>
      [...a].sort((a, b) => a - b)[Math.max(0, Math.ceil(a.length * 0.95) - 1)] || 0;
    return (
      '绘制 ' +
      mean(this.frames).toFixed(2) +
      ' ms / P95 ' +
      p95(this.frames).toFixed(2) +
      ' ms · ' +
      (1000 / Math.max(1, mean(this.intervals))).toFixed(0) +
      ' FPS' +
      (this.inputs.length ? ' · 输入派发 P95 ' + p95(this.inputs).toFixed(2) + ' ms' : '') +
      '。输入派发只测事件到程序处理，实际触屏、声音和屏幕延迟须实机测量。'
    );
  }
}
