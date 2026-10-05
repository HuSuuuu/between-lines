export type Vec = { x: number; y: number };
export type Keyframe = Vec & { t: number };
export type NoteKind = 'tap' | 'double' | 'swipe';
export type Note = {
  id: string;
  t: number;
  kind: NoteKind;
  track: 0 | 1;
  direction?: 'left' | 'right' | 'up' | 'down';
  rawTimes?: number[];
};
export type LyricLine = { id: string; text: string; t?: number; paragraph?: number };
export type Glyph = Vec & { text: string; size: number };
export type TextGroup = {
  id: string;
  text: string;
  role: 'body' | 'hero';
  orientation: 'horizontal' | 'vertical';
  glyphs: Glyph[];
  section: number;
};
export type Track = { id: 0 | 1; keys: Keyframe[] };
export type Duet = { id: string; start: number; end: number };
export type Fork = {
  eventId: string;
  track: 0 | 1;
  start: number;
  end: number;
  directionA: Note['direction'];
  directionB: Note['direction'];
  keysA: Keyframe[];
  keysB: Keyframe[];
};
export type Chapter = { id: string; title: string; start: number; end: number; anchor: Vec };
export type Chart = {
  version: 11;
  id: string;
  songId: string;
  title: string;
  artist: string;
  duration: number;
  revision: string;
  seed: number;
  tempo: number;
  speed: number;
  events: Note[];
  tracks: Track[];
  duets: Duet[];
  forks: Fork[];
  groups: TextGroup[];
  chapters: Chapter[];
  lyrics: LyricLine[];
  template: 'horizontal' | 'vertical' | 'inset';
  warnings: string[];
};
export type Settings = {
  music: number;
  hits: number;
  offset: number;
  effects: boolean;
  haptics: boolean;
  layout: 'auto' | 'landscape';
  difficulty: 'basic' | 'standard';
};
export type Result = {
  songId: string;
  chartId: string;
  revision: string;
  difficulty: string;
  score: number;
  grade: string;
  perfect: number;
  good: number;
  miss: number;
  extras: number;
  combo: number;
  total: number;
  just: number;
  accuracy: number;
  meanError: number | null;
  assisted: boolean;
  practice: boolean;
  date: string;
  routes: Vec[][];
};
export type Entry = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  audioId: string;
  audioName: string;
  builtin?: boolean;
  favorite: boolean;
  lastPlayed?: number;
  charts: Chart[];
  createdAt: number;
};
export type Draft = {
  id: string;
  songId: string;
  title: string;
  artist: string;
  audioId: string;
  audioName: string;
  duration: number;
  lyricsText: string;
  lyrics: LyricLine[];
  events: Note[];
  duets: Duet[];
  seed: number;
  tempo: number;
  template: Chart['template'];
  emphasis: string;
  chart?: Chart;
  updatedAt: number;
};
export type Profile = {
  settings: Settings;
  lastPage: string;
  bests: Record<string, Result>;
  history: Result[];
  legacyBests: Record<string, unknown>;
};
export type GenerationRequest = {
  id: string;
  songId: string;
  title: string;
  artist: string;
  duration: number;
  events: Note[];
  lyrics: LyricLine[];
  duets: Duet[];
  seed: number;
  tempo?: number;
  template?: Chart['template'];
  emphasis?: string;
};
export const defaults: Settings = {
  music: 100,
  hits: 100,
  offset: 0,
  effects: true,
  haptics: true,
  layout: 'auto',
  difficulty: 'standard',
};
