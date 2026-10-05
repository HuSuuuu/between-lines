import type { Note } from './types';

export const noteLabel = (note: Note) =>
  note.kind === 'double' ? '双押' : note.kind === 'swipe' ? '滑动' : '单击';
export const noteMark = (note: Note) =>
  note.kind === 'double' ? '●○' : note.kind === 'swipe' ? '↔' : note.track === 1 ? '○' : '●';
export const readingScale = (shortSide: number, spread: number) =>
  shortSide / Math.max(12, spread + 6);
export const glyphRasterSize = (size: number, shortSide: number, dpr: number) =>
  Math.round(Math.max(12, (size * shortSide) / 12) * dpr);
