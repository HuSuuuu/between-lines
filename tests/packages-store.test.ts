import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { exportPackage, importPackage } from '../src/packages';
import { LibraryStore, profileKey, cleanSettings } from '../src/store';
import { Engine } from '../src/engine';
import type { Entry } from '../src/types';
const entry = (JSON.parse(fs.readFileSync('public/catalog.json', 'utf8')).entries as Entry[]).find(
  (e) => e.id === 'practice',
)!;
describe('portable declarative packages', () => {
  it('roundtrips audio, lyrics, event timing, geometry and attribution exactly', async () => {
    const audio = new Blob([fs.readFileSync('public/assets/practice.wav')], { type: 'audio/wav' });
    const zip = await exportPackage(entry, audio, true),
      pack = await importPackage(zip);
    expect(pack.entry.charts).toEqual(entry.charts);
    expect(pack.entry.artist).toBe(entry.artist);
    expect(new Uint8Array(await pack.audio!.arrayBuffer())).toEqual(
      new Uint8Array(await audio.arrayBuffer()),
    );
  });
  it('supports chart-only sharing with a fingerprint to attach the original audio', async () => {
    const audio = new Blob(['sample']);
    const pack = await importPackage(await exportPackage(entry, audio, false));
    expect(pack.audio).toBeUndefined();
    expect(pack.expectedHash).toHaveLength(64);
    expect(pack.entry.charts).toEqual(entry.charts);
  });
  it('can back up a JSON-only work before music is attached', async () => {
    const imported = { ...entry, audioId: 'missing:practice' };
    const pack = await importPackage(await exportPackage(imported, undefined, false));
    expect(pack.audio).toBeUndefined();
    expect(pack.entry.audioId).toBe('missing:practice');
    expect(pack.entry.charts).toEqual(entry.charts);
    await expect(exportPackage(imported, undefined, true)).rejects.toThrow(/音乐/);
  });
  it('rejects corrupt archives, malformed version and invalid charts', async () => {
    await expect(importPackage(new Blob(['not a zip']))).rejects.toThrow();
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'between-lines', version: 99, entry })),
    });
    await expect(importPackage(new Blob([bytes]))).rejects.toThrow(/格式/);
    const malformed = structuredClone(entry);
    malformed.charts[0].events[0].t = -9;
    await expect(exportPackage(malformed, new Blob(['music']))).rejects.toThrow(/事件/);
  });
});
describe('persistent library and qualified records', () => {
  it('migrates prior settings and records without changing the old saved data', async () => {
    const previous = {
      settings: { music: 36, hits: 82, offset: -50, layout: 'landscape', difficulty: 'easy' },
      bests: { 'anti-utopia:easy': { score: 970 } },
    };
    const original = JSON.stringify(previous),
      getItem = vi.fn(() => original);
    vi.stubGlobal('localStorage', { getItem });
    const profile = await new LibraryStore().profile();
    expect(profile.settings).toMatchObject({ ...previous.settings, difficulty: 'basic' });
    expect(profile.legacyBests).toEqual(previous.bests);
    expect(getItem).toHaveBeenCalledWith('between-lines-game-v1');
    expect(JSON.stringify(previous)).toBe(original);
    expect(
      cleanSettings({ music: NaN, hits: 500, offset: -600, layout: 'garbage' as any }),
    ).toMatchObject({ music: 100, hits: 100, offset: -250, layout: 'auto' });
    vi.unstubAllGlobals();
  });
  it('persists draft, music and library across new store instances', async () => {
    const a = await new LibraryStore().open();
    expect(await a.put('entries', 'test-entry', entry)).toBe(true);
    expect(await a.put('audio', 'test-audio', new Blob(['music']))).toBe(true);
    expect(await a.put('drafts', 'test-draft', { id: 'test-draft', title: 'unfinished' })).toBe(
      true,
    );
    const b = await new LibraryStore().open();
    expect(await b.get('entries', 'test-entry')).toEqual(entry);
    expect(await b.get('drafts', 'test-draft')).toEqual({ id: 'test-draft', title: 'unfinished' });
    a.db?.close();
    b.db?.close();
  });
  it('excludes practice and every assisted run; separates content revisions', async () => {
    const db = await new LibraryStore().open(),
      profile = await db.profile(),
      engine = new Engine(entry.charts[0]);
    engine.tick(entry.duration + 0.5, true);
    const result = engine.result();
    expect(await db.record(profile, { ...result, assisted: true })).toBe(false);
    expect(await db.record(profile, { ...result, practice: true })).toBe(false);
    expect(profile.history).toHaveLength(0);
    expect(await db.record(profile, result)).toBe(true);
    await db.record(profile, { ...result, revision: 'changed' });
    expect(Object.keys(profile.bests)).toHaveLength(2);
    expect(await db.get('profile', profileKey)).toEqual(profile);
    db.db?.close();
  });
  it('reports failed persistence but keeps a recoverable in-session copy', async () => {
    const db = new LibraryStore();
    expect(await db.put('drafts', 'temp', { id: 'temp', title: 'recoverable' })).toBe(false);
    expect(await db.get('drafts', 'temp')).toEqual({ id: 'temp', title: 'recoverable' });
  });
});
