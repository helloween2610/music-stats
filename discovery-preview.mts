import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { discoveryRoute } from './server/src/discoveryRoute';
import type { DiscoveryStore, Track } from './server/src/discovery';

// Only the new read-only features use a local service in preview. Existing app data
// still comes from the configured production API. No cloud library job is resumed.
export function discoveryPreview(): Plugin {
  // Read the existing server secret only in Vite's server process, never the client bundle.
  let lastfmApiKey = process.env.LASTFM_API_KEY || '';
  let lastfmUser = process.env.LASTFM_USER || '';
  try {
    const vars = readFileSync(new URL('../../server/.dev.vars', import.meta.url), 'utf8');
    lastfmApiKey ||= vars.match(/^LASTFM_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1] || '';
    lastfmUser ||= vars.match(/^LASTFM_USER\s*=\s*["']?([^\s"']+)/m)?.[1] || '';
  } catch {}
  if (!lastfmUser) {
    try {
      const config = readFileSync(new URL('../../server/wrangler.jsonc', import.meta.url), 'utf8');
      lastfmUser = config.match(/["']LASTFM_USER["']\s*:\s*["']([^"']+)["']/)?.[1] || '';
    } catch {}
  }
  const values = new Map<string,{value:any;expires:number}>(), rates = new Map<string,number>();
  let releaseScanSettings={watchlist:[] as string[],excluded:[] as string[],recentDays:90 as 90|180,updatedAt:''};
  const store: DiscoveryStore = {
    async get(key) { const hit=values.get(key); return hit && hit.expires>Date.now() ? hit.value : null; },
    async put(key,value,seconds) { values.set(key,{value,expires:Date.now()+seconds*1000}); },
    async acquire(provider,ms) { const now=Date.now(); if ((rates.get(provider)||0)>now) return false; rates.set(provider,now+ms); return true; },
  };
  const catalogs = new Map<string,{rows:Track[];expires:number}>();
  return {name:'music-discovery-preview',configureServer(server) {
    server.middlewares.use('/__api',async(req,res,next)=>{
      const url=new URL(req.url||'/','http://localhost');
      if(url.pathname!=='/settings/release-scan'){next();return;}
      if(req.method==='GET'){res.statusCode=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({settings:releaseScanSettings}));return;}
      if(req.method==='POST'){
        let raw='';req.on('data',chunk=>{raw+=chunk;});req.on('end',()=>{
          try{
            const body=JSON.parse(raw||'{}');
            const clean=(value:any)=>Array.isArray(value)?[...new Set(value.map((n:any)=>String(n||'').trim()).filter(Boolean))].slice(0,1000):[];
            releaseScanSettings={watchlist:clean(body.watchlist),excluded:clean(body.excluded),recentDays:Number(body.recentDays)===180?180:90,updatedAt:new Date().toISOString()};
            res.statusCode=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({settings:releaseScanSettings}));
          }catch{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'invalid_settings'}));}
        });return;
      }
      res.statusCode=405;res.end();
    });
    server.middlewares.use('/__discovery',async(req,res,next)=>{
      if (req.method!=='GET') {res.statusCode=405;res.end();return;}
      const auth=req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {res.statusCode=401;res.end();return;}
      // Use the deployed persistent catalog/release stores just like Zalo. The local
      // preview store is intentionally in-memory, so serving release routes locally
      // would make the saved album list disappear whenever Vite restarts.
      const deployedRoutes=new Set(['/apple-music','/apple-playlist-song','/release-artists','/upcoming','/album-tracks','/album-recommendations']);
      if(deployedRoutes.has(new URL(req.url||'/','http://localhost').pathname)){
        try{
          const response=await fetch('https://stats.helloween2610.workers.dev/discovery'+req.url,{headers:{Authorization:auth},signal:AbortSignal.timeout(90000)});
          res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());
        }catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Discovery service unavailable'}));}
        return;
      }
      const tracks=async()=>{
        const cached=catalogs.get(auth); if(cached && cached.expires>Date.now())return cached.rows;
        const rows:Track[]=[];
        for(let offset=0;offset<100000;offset+=1000){
          const r=await fetch('https://stats.helloween2610.workers.dev/library/tracks?limit=1000&offset='+offset,{headers:{Authorization:auth},signal:AbortSignal.timeout(12000)});
          if(!r.ok)throw Error('Catalog unavailable');
          const page=(await r.json()).rows; if(!Array.isArray(page))throw Error('Invalid catalog');rows.push(...page);if(page.length<1000)break;
        }
        const counts = await fetch('https://stats.helloween2610.workers.dev/ratings', {headers:{Authorization:auth},signal:AbortSignal.timeout(12000)});
        if (!counts.ok) throw Error('Listening totals unavailable');
        const ratings = (await counts.json()).rows;
        if (!Array.isArray(ratings)) throw Error('Invalid listening totals');
        const plays = new Map(ratings.map((r:any)=>[r.track_id,r.plays]));
        rows.forEach(t=>{t.plays=Number(plays.get(t.id)||0);});
        catalogs.set(auth,{rows,expires:Date.now()+120000});return rows;
      };
      const requestUrl=new URL(req.url||'/','http://localhost');
      if(requestUrl.pathname==='/now-playing' && requestUrl.searchParams.get('mock')==='1'){
        const library=await tracks();
        const sample=library.find(track=>track.in_library!==0 && track.artist==='MONO' && track.title==='Everlasting Light')
          || library.find(track=>track.in_library!==0 && !!track.album && !!track.duration_s);
        if(!sample){res.statusCode=404;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Không có bài mẫu trong thư viện.'}));return;}
        let image:string|undefined;
        try{
          const artworkResponse=await fetch('https://stats.helloween2610.workers.dev/artwork',{headers:{Authorization:auth},signal:AbortSignal.timeout(12000)});
          const artwork:any=artworkResponse.ok?await artworkResponse.json():{};
          image=artwork.tracks?.[sample.id] || artwork.albums?.[(sample.album_artist||sample.artist)+'\u001f'+sample.album] || undefined;
        }catch{}
        res.statusCode=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({track:{
          title:sample.title,artist:sample.album_artist||sample.artist||'',album:sample.album||undefined,image,
          libraryTrackId:sample.id,duration_s:sample.duration_s||undefined,year:sample.year||undefined,
          date_added:sample.date_added||undefined,last_played:sample.last_played||undefined,my_rating:sample.my_rating||undefined,plays:sample.plays||0,
        },checkedAt:new Date().toISOString(),previewMock:true}));return;
      }
      const response=await discoveryRoute(new URL('/discovery'+req.url,'http://localhost'),tracks,store,lastfmApiKey,lastfmUser);
      res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());
    });
  }};
}
