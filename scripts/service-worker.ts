export function serviceWorker(cache: string, urls: string[], fonts: string[]) {
  return `const CACHE=${JSON.stringify(cache)};
const CORE=${JSON.stringify(urls)};
const FONTS=${JSON.stringify(fonts)};
const MEDIA='between-lines-media-v1';
let warming=false,warm=false;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(let i=0;i<CORE.length;i+=3)await cache.addAll(CORE.slice(i,i+3));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const media=await caches.open(MEDIA),keys=await caches.keys();
 for(const key of keys.filter(k=>k.startsWith('between-lines-v2-')&&k!==CACHE)){
  const previous=await caches.open(key);
  for(const req of await previous.keys()){
   if(!/\\.(woff2|mp3|m4a|wav)$/.test(new URL(req.url).pathname)||await media.match(req))continue;
   const response=await previous.match(req);if(response)await media.put(req,response);
  }
  await caches.delete(key);
 }
 await self.clients.claim();
})()));
async function notifyFonts(){for(const client of await self.clients.matchAll())client.postMessage({type:'fonts-ready'});}
async function warmFonts(){
 if(warming)return;
 warming=true;
 try{
  const cache=await caches.open(MEDIA);
  for(const url of FONTS){
   if(!warm)return;
   if(await cache.match(url))continue;
   const response=await fetch(url,{priority:'low'});
   if(!response.ok)return;
   await cache.put(url,response);
  }
  await notifyFonts();
 }finally{warming=false;}
}
self.addEventListener('message',event=>{
 if(event.data?.type==='pause-fonts')warm=false;
 if(event.data?.type==='warm-fonts'){warm=true;event.waitUntil(warmFonts().catch(()=>{}));}
});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope)||req.headers.has('range'))return;
 if(url.pathname.endsWith('.zip')||url.pathname.includes('legacy-'))return;
 event.respondWith((async()=>{
  const immutable=/\\.(woff2?|mp3|m4a|wav)$/.test(url.pathname);
  const cache=await caches.open(immutable?MEDIA:CACHE),cached=await cache.match(req);
  if(immutable&&cached)return cached;
  try{
   const response=await fetch(req);
   if(response.ok)event.waitUntil(cache.put(req,response.clone()).catch(()=>{}));
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
}
