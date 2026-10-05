import type { Entry, Draft, Profile, Result, Settings } from './types';
import { defaults } from './types';
export function cleanSettings(value: Partial<Settings> & { difficulty?: any } = {}): Settings {
  value = value && typeof value === 'object' ? value : {};
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    music: finite(value.music, 100, 0, 100),
    hits: finite(value.hits, 100, 0, 100),
    offset: finite(value.offset, 0, -250, 250),
    effects: value.effects !== false,
    haptics: value.haptics !== false,
    layout: value.layout === 'landscape' ? 'landscape' : 'auto',
    difficulty: value.difficulty === 'basic' || value.difficulty === 'easy' ? 'basic' : 'standard',
  };
}
export const profileKey = 'between-lines-profile-v2';
export class LibraryStore {
  db?: IDBDatabase;
  memory = new Map<string, Map<string, any>>();
  persistent = false;
  reason = '';
  unsaved = new Set<string>();
  async open() {
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('between-lines-library', 1);
        req.onupgradeneeded = () => {
          for (const name of ['entries', 'drafts', 'audio', 'profile'])
            if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(Error('资料库被其他页面占用'));
      });
      this.persistent = true;
      this.db.onversionchange = () => {
        this.db?.close();
        this.persistent = false;
        this.reason = '资料库版本改变，请刷新后继续保存';
      };
    } catch (e) {
      this.reason = e instanceof Error ? e.message : '浏览器未允许保存';
    }
    return this;
  }
  private bucket(name: string) {
    if (!this.memory.has(name)) this.memory.set(name, new Map());
    return this.memory.get(name)!;
  }
  async get<T>(name: string, key: string): Promise<T | undefined> {
    if (this.bucket(name).has(key)) return this.bucket(name).get(key);
    if (!this.db || !this.persistent) return undefined;
    return new Promise((resolve, reject) => {
      const req = this.db!.transaction(name).objectStore(name).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async all<T>(name: string): Promise<T[]> {
    const entries = new Map(this.bucket(name));
    if (this.db && this.persistent) {
      await new Promise<void>((resolve, reject) => {
        const r = this.db!.transaction(name).objectStore(name).openCursor();
        r.onsuccess = () => {
          const cursor = r.result;
          if (cursor) {
            if (!entries.has(String(cursor.key))) entries.set(String(cursor.key), cursor.value);
            cursor.continue();
          } else resolve();
        };
        r.onerror = () => reject(r.error);
      });
    }
    return [...entries.values()];
  }
  async put(name: string, key: string, value: unknown) {
    this.bucket(name).set(key, structuredClone(value));
    this.unsaved.add(name + ':' + key);
    if (!this.db || !this.persistent) return false;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(name, 'readwrite');
        tx.objectStore(name).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error('保存取消'));
      });
      this.unsaved.delete(name + ':' + key);
      return true;
    } catch (e) {
      this.reason = e instanceof Error ? e.message : '存储空间不足';
      return false;
    }
  }
  async remove(name: string, key: string) {
    this.bucket(name).delete(key);
    if (this.db && this.persistent)
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(name, 'readwrite');
        tx.objectStore(name).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
  }
  async profile(): Promise<Profile> {
    const saved = await this.get<Profile>('profile', profileKey);
    if (saved)
      return {
        ...saved,
        settings: cleanSettings(saved.settings),
        bests: saved.bests || {},
        history: Array.isArray(saved.history) ? saved.history.slice(0, 30) : [],
        legacyBests: saved.legacyBests || {},
      };
    let legacy: any = {};
    try {
      legacy = JSON.parse(localStorage.getItem('between-lines-game-v1') || '{}');
    } catch {}
    return {
      settings: cleanSettings(legacy.settings),
      lastPage: 'anti-utopia',
      bests: {},
      history: [],
      legacyBests: legacy.bests || {},
    };
  }
  async record(profile: Profile, result: Result) {
    if (result.assisted || result.practice) return false;
    const key = [result.chartId, result.revision, result.difficulty].join(':');
    const old = profile.bests[key];
    if (!old || result.score > old.score) profile.bests[key] = result;
    profile.history.unshift(result);
    profile.history = profile.history.slice(0, 30);
    return this.put('profile', profileKey, profile);
  }
  entries() {
    return this.all<Entry>('entries');
  }
  drafts() {
    return this.all<Draft>('drafts');
  }
}
