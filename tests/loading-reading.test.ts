import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import { AudioLibrary } from '../src/audio-library';
import { serviceWorker } from '../scripts/service-worker';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { generate } from '../src/generator';
import { defaults } from '../src/types';

describe('song preparation and streamed offline cache', () => {
  it('pauses font warmup after its in-flight subset and resumes from cached progress', async () => {
    const handlers: Record<string, (event: any) => void> = {};
    const saved = new Map<string, Response>();
    let release!: (r: Response) => void;
    const network = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
      .mockResolvedValue(new Response('font-b'));
    const context = {
      self: {
        addEventListener: (type: string, handler: any) => (handlers[type] = handler),
        clients: { matchAll: async () => [] },
      },
      caches: {
        open: async () => ({
          match: async (key: string) => saved.get(key),
          put: async (key: string, r: Response) => {
            saved.set(key, r);
          },
        }),
      },
      URL,
      fetch: network,
    };
    vm.runInNewContext(serviceWorker('shell', ['./'], ['./a.woff2', './b.woff2']), context);
    let job!: Promise<unknown>;
    handlers.message({
      data: { type: 'warm-fonts' },
      waitUntil: (p: Promise<unknown>) => (job = p),
    });
    await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
    handlers.message({ data: { type: 'pause-fonts' } });
    release(new Response('font-a'));
    await job;
    expect(network).toHaveBeenCalledOnce();
    handlers.message({
      data: { type: 'warm-fonts' },
      waitUntil: (p: Promise<unknown>) => (job = p),
    });
    await job;
    expect(network).toHaveBeenCalledTimes(2);
    expect(saved.size).toBe(2);
  });
  it('shares prefetch with play, reports progress, and reuses the same song blob', async () => {
    vi.stubGlobal('location', { href: 'https://game.test/space/' });
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4' } }),
    );
    vi.stubGlobal('fetch', fetch);
    const library = new AudioLibrary(async () => undefined);
    const progress: number[] = [];
    const [prefetch, play] = await Promise.all([
      library.load('builtin:practice'),
      library.load('builtin:practice', (p) => progress.push(p.loaded)),
    ]);
    expect(play).toBe(prefetch);
    expect(progress).toContain(4);
    expect(await library.load('builtin:practice')).toBe(play);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('failed prefetch can retry instead of poisoning subsequent play', async () => {
    vi.stubGlobal('location', { href: 'https://game.test/space/' });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(Error('offline'))
      .mockResolvedValue(new Response('song'));
    vi.stubGlobal('fetch', fetch);
    const library = new AudioLibrary(async () => undefined);
    await expect(library.load('builtin:practice')).rejects.toThrow('offline');
    expect(await library.load('builtin:practice')).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
  it('delivers the music response while its offline copy is still being written', async () => {
    const handlers: Record<string, (event: any) => void> = {};
    let completeWrite!: () => void;
    const write = new Promise<void>((r) => (completeWrite = r));
    const cache = { match: async () => undefined, put: vi.fn(() => write) };
    const context = {
      self: {
        location: { origin: 'https://game.test' },
        registration: { scope: 'https://game.test/space/' },
        addEventListener: (type: string, handler: any) => (handlers[type] = handler),
      },
      caches: { open: async () => cache },
      URL,
      fetch: async () => new Response('music'),
    };
    vm.runInNewContext(serviceWorker('test-shell', ['./'], ['./font.woff2']), context);
    let response!: Promise<Response>;
    const background: Promise<unknown>[] = [];
    handlers.fetch({
      request: new Request('https://game.test/space/assets/song.mp3'),
      respondWith: (r: Promise<Response>) => (response = r),
      waitUntil: (r: Promise<unknown>) => background.push(r),
    });
    const delivered = await response;
    expect(await delivered.text()).toBe('music');
    expect(cache.put).toHaveBeenCalledOnce();
    expect(background).toHaveLength(1);
    completeWrite();
    await Promise.all(background);
  });
});

describe('stable dual-track rendering', () => {
  it('does not rerasterize typography for every frame of a split or zoom', () => {
    const context = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) } as any, {
      get(target, key) {
        return key in target ? target[key] : () => {};
      },
    });
    const canvas = () => ({
      width: 0,
      height: 0,
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 390, height: 744 }),
    });
    vi.stubGlobal('document', { body: { dataset: {} }, createElement: () => canvas() });
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const chart = generate({
      id: 'draw',
      songId: 'draw',
      title: '云',
      artist: '',
      duration: 9,
      lyrics: [{ id: 'l', text: '云云云云' }],
      events: Array.from({ length: 16 }, (_, i) => ({
        id: 'n' + i,
        t: 1 + i * 0.4,
        kind: i % 4 === 0 ? 'double' : 'tap',
        track: 0,
      })),
      duets: [{ id: 'duet', start: 1, end: 7 }],
      seed: 42,
    });
    const renderer = new Renderer(canvas() as any, new Engine(chart), {
      ...defaults,
      effects: false,
    });
    for (let frame = 0; frame < 240; frame++) renderer.draw(frame / 30, (frame * 1000) / 30);
    // There is one glyph, six actual font sizes, and a few original/title sizes.
    // Hundreds of camera samples must reuse those bitmap sizes.
    expect(renderer.rasterCreated).toBeLessThanOrEqual(9);
    const count = renderer.rasterCreated;
    renderer.resize();
    renderer.draw(7, 8100);
    expect(renderer.rasterCreated).toBe(count);
    vi.unstubAllGlobals();
  });
});
