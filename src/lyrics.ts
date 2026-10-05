import type { LyricLine } from './types';
export function parseLyrics(input: string): LyricLine[] {
  const out: LyricLine[] = [];
  let offset = 0,
    paragraph = 0,
    afterLine = false;
  const offsetMatch = input.match(/\[offset:([+-]?\d+)\]/i);
  if (offsetMatch) offset = Number(offsetMatch[1]) / 1000;
  for (const raw of input.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) {
      if (afterLine) paragraph++;
      afterLine = false;
      continue;
    }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = raw
      .replace(
        /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]|\[(?:ar|al|ti|by|offset|re|ve|length):[^\]]*\]/gi,
        '',
      )
      .trim();
    if (!text) continue;
    afterLine = true;
    if (stamps.length) {
      for (const m of stamps) {
        const fraction = m[3] ? Number('0.' + m[3]) : 0;
        out.push({
          id: 'lyric-' + out.length,
          text,
          paragraph,
          t: Math.max(0, Number(m[1]) * 60 + Number(m[2]) + fraction + offset),
        });
      }
    } else if (!/^\s*\[[a-z]+:/i.test(raw)) {
      out.push({ id: 'lyric-' + out.length, text, paragraph });
    }
  }
  if (out.length && out.every((line) => line.t !== undefined)) out.sort((a, b) => a.t! - b.t!);
  return out.map((line, i) => ({ ...line, id: 'lyric-' + i }));
}
export function lyricsAsLrc(lines: LyricLine[]): string {
  return lines
    .map((l, i) => {
      const prefix =
        i && l.paragraph !== undefined && l.paragraph !== lines[i - 1].paragraph ? '\n' : '';
      if (l.t === undefined) return prefix + l.text;
      const t = Math.max(0, l.t),
        m = Math.floor(t / 60),
        s = (t % 60).toFixed(2).padStart(5, '0');
      return prefix + '[' + String(m).padStart(2, '0') + ':' + s + ']' + l.text;
    })
    .join('\n');
}
