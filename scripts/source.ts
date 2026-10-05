import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
export function sourceArchive() {
  const files: Record<string, Uint8Array> = {};
  const ignored = new Set(['node_modules', 'dist', '.git', 'coverage', 'proof']);
  const excluded = new Set([
    'public/source.zip',
    'public/catalog.json',
    'public/example.chart.json',
    'public/assets/anti-utopia.mp3',
    'public/assets/legacy-chart.json',
    'public/assets/legacy-lyrics.json',
  ]);
  function walk(folder: string) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (
        ignored.has(entry.name) ||
        entry.name === '.DS_Store' ||
        entry.name.startsWith('.env') ||
        entry.name.startsWith('verification')
      )
        continue;
      const file = path.join(folder, entry.name);
      const relative = path.relative('.', file).replaceAll(path.sep, '/');
      if (excluded.has(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file);
      else files['between-lines/' + relative] = fs.readFileSync(file);
    }
  }
  walk('.');
  return zipSync(files, { level: 6, mtime: '2020-01-01T00:00:00' });
}
if (process.argv[1]?.endsWith('source.ts')) {
  fs.writeFileSync('public/source.zip', sourceArchive());
  console.log('Portable MIT source archive created; song resources excluded.');
}
