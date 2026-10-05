export type LoadProgress = { loaded: number; total: number; cached: boolean };

/** Share prefetch and play requests, retaining at most two compressed songs. */
export class AudioLibrary {
  private ready = new Map<string, Blob>();
  private pending = new Map<string, Promise<Blob | undefined>>();
  private listeners = new Map<string, Set<(progress: LoadProgress) => void>>();
  constructor(readonly local: (id: string) => Promise<Blob | undefined>) {}
  load(id: string, progress?: (p: LoadProgress) => void): Promise<Blob | undefined> {
    const saved = this.ready.get(id);
    if (saved) {
      this.ready.delete(id);
      this.ready.set(id, saved);
      progress?.({ loaded: saved.size, total: saved.size, cached: true });
      return Promise.resolve(saved);
    }
    const listeners = this.listeners.get(id) || new Set();
    if (progress) listeners.add(progress);
    this.listeners.set(id, listeners);
    let request = this.pending.get(id);
    if (!request) {
      request = this.read(id)
        .then((blob) => {
          if (blob) {
            this.ready.set(id, blob);
            let bytes = [...this.ready.values()].reduce((n, b) => n + b.size, 0);
            while (this.ready.size > 2 || (bytes > 32 * 1024 * 1024 && this.ready.size > 1)) {
              const oldest = this.ready.keys().next().value!;
              bytes -= this.ready.get(oldest)!.size;
              this.ready.delete(oldest);
            }
          }
          return blob;
        })
        .finally(() => {
          this.pending.delete(id);
          this.listeners.delete(id);
        });
      this.pending.set(id, request);
    }
    return request;
  }
  private emit(id: string, progress: LoadProgress) {
    for (const listener of this.listeners.get(id) || []) listener(progress);
  }
  private async read(id: string): Promise<Blob | undefined> {
    const own = await this.local(id);
    if (own) return own;
    if (!id.startsWith('builtin:')) return undefined;
    const optimized = id.match(/^builtin:anti-utopia-aac:([a-f0-9]{16})$/);
    const file =
      id === 'builtin:practice'
        ? 'practice.wav'
        : optimized
          ? 'anti-utopia-play.m4a?v=' + optimized[1]
          : 'anti-utopia.mp3';
    const response = await fetch(new URL('assets/' + file, location.href), { priority: 'high' });
    if (!response.ok) throw Error('音乐下载失败，请重试');
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body) return response.blob();
    const reader = response.body.getReader(),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value));
      loaded += value.byteLength;
      this.emit(id, { loaded, total, cached: false });
    }
    this.emit(id, { loaded, total: loaded, cached: false });
    return new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
  }
}
