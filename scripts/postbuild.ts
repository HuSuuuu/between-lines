import { serviceWorker } from './service-worker';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sourceArchive } from './source';
const root = 'dist';
fs.copyFileSync(
  'node_modules/@fontsource/noto-serif-sc/LICENSE',
  path.join(root, 'FONT-LICENSE.txt'),
);
fs.copyFileSync('node_modules/fflate/LICENSE', path.join(root, 'FFLATE-LICENSE.txt'));
fs.copyFileSync('LICENSE', path.join(root, 'LICENSE.txt'));
fs.copyFileSync('NOTICE.md', path.join(root, 'NOTICE.md'));
fs.writeFileSync(path.join(root, 'source.zip'), sourceArchive());
function walk(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = walk(root).filter(
  (file) => !/\.(mp3|m4a|zip)$/.test(file) && !file.includes('legacy-') && !file.endsWith('sw.js'),
);
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(file).update(fs.readFileSync(file));
const cache = 'between-lines-v2-' + hash.digest('hex').slice(0, 12);
const fonts = files
  .filter((file) => file.endsWith('.woff2'))
  .map((file) => './' + path.relative(root, file).replaceAll(path.sep, '/'));
const urls = files
  .filter((file) => !/\.woff2?$/.test(file))
  .map((file) => './' + path.relative(root, file).replaceAll(path.sep, '/'));
urls.push('./');
const sw = serviceWorker(cache, urls, fonts);
fs.writeFileSync(path.join(root, 'sw.js'), sw);
console.log('Offline shell:', urls.length, 'resources; deferred font subsets:', fonts.length);
