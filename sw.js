/* Network-first shell so a home-screen install does not stay on an old build. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function(event){
  var req=event.request;
  if(req.method!=='GET') return;
  var url;
  try{ url=new URL(req.url); }catch(e){ return; }
  if(url.origin!==self.location.origin) return;
  var shell=req.mode==='navigate' || /\/(index\.html|sync-merge\.js|sw\.js|manifest\.json)$/.test(url.pathname) || /\/eva-meal\/?$/.test(url.pathname);
  if(!shell) return;
  event.respondWith(fetch(req, {cache:'no-store'}).then(function(res){
    var copy=res.clone();
    caches.open('meal-shell-20261107-0730').then(function(cache){ cache.put(req, copy); }).catch(function(){});
    return res;
  }).catch(function(){ return caches.match(req); }));
});
