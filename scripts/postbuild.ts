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
  (file) => !/\.(mp3|zip)$/.test(file) && !file.includes('legacy-') && !file.endsWith('sw.js'),
);
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(file).update(fs.readFileSync(file));
const cache = 'between-lines-v2-' + hash.digest('hex').slice(0, 12);
const urls = files.map((file) => './' + path.relative(root, file).replaceAll(path.sep, '/'));
urls.push('./');
const sw = `const CACHE=${JSON.stringify(cache)};
const CORE=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(let i=0;i<CORE.length;i+=8)await cache.addAll(CORE.slice(i,i+8));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k.startsWith('between-lines-v2-')&&k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope)||req.headers.has('range'))return;
 if(url.pathname.endsWith('.zip')||url.pathname.includes('legacy-'))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),cached=await cache.match(req);
  const immutable=/\\.(woff2?|mp3|wav)$/.test(url.pathname);
  if(immutable&&cached)return cached;
  try{
   const response=await fetch(req);
   if(response.ok){try{await cache.put(req,response.clone());}catch{}}
   if(!response.ok&&cached)return cached;
   return response;
  }catch{
   if(cached)return cached;
   if(req.mode==='navigate'){const home=await cache.match('./');if(home)return home;}
   return Response.error();
  }
 })());
});
`;
fs.writeFileSync(path.join(root, 'sw.js'), sw);
console.log('Offline cache:', urls.length, 'resources; complete font coverage and source archive.');
