// Service worker: keeps a copy of the app so it opens at the rack with no
// signal. The page is fetched network first (a deploy shows up on the next load
// with signal), falling back to the cached copy after a short wait; icons,
// manifests and Google Fonts are served from cache and refreshed behind the scenes.
//
// The live site's worker (scope /531/) also covers /531/dev/, so it leaves any
// request under its own scope's dev/ alone and the dev build's worker handles it.
"use strict";

var SCOPE = self.registration.scope;
var CACHE = "531-planner:" + SCOPE;
var FONT_CACHE = "531-planner-fonts";
var SHELL = ["./", "manifest.webmanifest", "manifest-dev.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-dev-192.png", "icons/icon-dev-512.png"];
var NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", function(event){
  event.waitUntil(caches.open(CACHE).then(function(cache){ return cache.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(event){
  event.waitUntil(self.clients.claim());
});

function isFont(url){ return url.hostname==="fonts.googleapis.com" || url.hostname==="fonts.gstatic.com"; }

function fromCacheThenRefresh(cacheName, request){
  return caches.open(cacheName).then(function(cache){
    return cache.match(request).then(function(hit){
      var fetched = fetch(request).then(function(res){
        if(res && (res.ok || res.type==="opaque")) cache.put(request, res.clone());
        return res;
      });
      if(hit){ fetched.catch(function(){}); return hit; }
      return fetched;
    });
  });
}

function pageNetworkFirst(request){
  return caches.open(CACHE).then(function(cache){
    var network = fetch(request).then(function(res){
      if(res && res.ok) cache.put(SCOPE, res.clone());
      return res;
    });
    var fallback = new Promise(function(resolve){
      setTimeout(function(){ cache.match(SCOPE).then(function(hit){ if(hit) resolve(hit); }); }, NETWORK_TIMEOUT_MS);
    });
    var offline = network.catch(function(){
      return cache.match(SCOPE).then(function(hit){ return hit || Promise.reject(new Error("offline and not cached")); });
    });
    return Promise.race([offline, fallback]);
  });
}

self.addEventListener("fetch", function(event){
  var request = event.request;
  if(request.method!=="GET") return;
  var url = new URL(request.url);
  if(isFont(url)){ event.respondWith(fromCacheThenRefresh(FONT_CACHE, request)); return; }
  // Google sign-in and Drive, and anything outside this app, go straight to the network
  if(request.url.indexOf(SCOPE)!==0) return;
  if(request.url.indexOf(SCOPE + "dev/")===0) return;
  if(request.mode==="navigate"){ event.respondWith(pageNetworkFirst(request)); return; }
  event.respondWith(fromCacheThenRefresh(CACHE, request));
});
