import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../src/generator';
import { adaptLegacy, builtinEntry } from '../src/legacy';
import { validateChart, checkClearance } from '../src/validate';
import type { Entry, Note } from '../src/types';
const root = path.resolve('public'),
  assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });
const rate = 16000,
  duration = 24,
  samples = rate * duration,
  wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF');
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
let random = 1;
for (let i = 0; i < samples; i++) {
  const t = i / rate,
    beat = t % 0.5,
    bar = Math.floor(t / 2) % 8,
    f = melody[bar],
    env = Math.exp(-beat * 8),
    kick =
      Math.sin(2 * Math.PI * (50 * beat + (45 * (1 - Math.exp(-beat * 20))) / 20)) *
      Math.exp(-beat * 20);
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  const noise = ((random / 4294967296) * 2 - 1) * Math.exp(-beat * 80);
  const tone = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t)) * env;
  const value = Math.max(-1, Math.min(1, tone * 0.13 + kick * 0.18 + noise * 0.035));
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
fs.writeFileSync(path.join(assets, 'practice.wav'), wav);
const lines = [
  '光从字缝里经过',
  '两条线读同一句',
  '让一拍落在指尖',
  '让另一拍穿过纸页',
  '分开也有共同的节奏',
  '相逢在下一个转角',
];
const charts = ['同拍双押', '交替穿行', '分合与岔路'].map((name, index) => {
  const events: Note[] = Array.from({ length: 40 }, (_, i) => ({
    id: 'practice-' + index + '-' + i,
    t: 1 + i * 0.5,
    kind: index === 0 && i % 6 === 3 ? 'double' : 'tap',
    track: 0,
  }));
  if (index === 2) events[32].kind = 'swipe';
  const c = generate({
    id: 'practice-' + index,
    songId: 'practice',
    title: name,
    artist: '字里行间 / 原创练习',
    duration,
    events,
    lyrics: lines.map((text, i) => ({ id: 'practice-line-' + i, text, t: i * 4 })),
    duets: [{ id: 'sample-duet', start: index === 0 ? 4 : 3, end: 14 }],
    seed: 20261005 + index,
    tempo: 120,
    template: (['horizontal', 'vertical', 'inset'] as const)[index],
    emphasis: index === 0 ? '同拍' : index === 1 ? '同行' : '相逢',
  });
  validateChart(c);
  if (checkClearance(c)) throw Error('Training text overlaps route');
  return c;
});
const training: Entry = {
  id: 'practice',
  title: '三页练习',
  artist: '字里行间 / 原创',
  duration,
  audioId: 'builtin:practice',
  audioName: 'practice.wav',
  builtin: true,
  favorite: false,
  charts,
  createdAt: 0,
};
const entries: Entry[] = [training];
if (
  fs.existsSync(path.join(assets, 'legacy-chart.json')) &&
  fs.existsSync(path.join(assets, 'legacy-lyrics.json'))
) {
  const old = JSON.parse(fs.readFileSync(path.join(assets, 'legacy-chart.json'), 'utf8')),
    lyrics = JSON.parse(fs.readFileSync(path.join(assets, 'legacy-lyrics.json'), 'utf8')).lines;
  const legacy = adaptLegacy(old, lyrics);
  validateChart(legacy);
  const updated = generate({
    id: 'anti-utopia-duet',
    songId: 'anti-utopia',
    title: old.title,
    artist: old.artist,
    duration: old.duration,
    events: legacy.events,
    lyrics: legacy.lyrics,
    duets: [
      { id: 'chorus-a', start: 40, end: 54 },
      { id: 'chorus-b', start: 87, end: 100 },
      { id: 'finale', start: 117, end: 132 },
    ],
    seed: 20261006,
    tempo: 120,
    template: 'inset',
    emphasis: '字里行间,自由,反乌托邦',
  });
  validateChart(updated);
  if (checkClearance(updated)) throw Error('Generated text overlaps route');
  const entry = builtinEntry(updated);
  entry.charts.push(legacy);
  entries.unshift(entry);
}
fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({ version: 1, entries }, null, 2));
fs.writeFileSync(path.join(root, 'example.chart.json'), JSON.stringify(charts[0], null, 2));
console.log(
  'Prepared ' +
    entries.length +
    ' works; ' +
    charts.length +
    ' tested multi-ball studies; ' +
    entries.map((e) => e.title + ': ' + e.charts.map((c) => c.events.length).join('/')).join(', '),
);
