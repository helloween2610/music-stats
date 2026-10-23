import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({stdin:{contents:`export * from './server/src/discovery'; export * from './shared/releases'; export * from './server/src/appleMusic'; export * from './server/src/albumTracks'; export * from './server/src/bandcamp'; export * from './src/lib/apple-music-opening'; export {releasePhase,releaseDate,releaseGroup,loadNowPlaying} from './src/lib/discovery';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'}});
globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{}}};
const app=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const track=(artist,duration,plays,extra={})=>({id:'TR1',title:'Song',album:'Known album',artist,duration_s:duration,plays,in_library:1,...extra});
function store(){const cache=new Map();return {cache,async get(k){return cache.get(k)??null;},async put(k,v){cache.set(k,v);},async acquire(){return true;}};}
const applePage=items=>new Response(`<script type="application/json" id="serialized-server-data">${JSON.stringify({data:[{data:{sections:[{items}]}}]})}</script>`,{headers:{'Content-Type':'text/html'}});

test('now-playing client accepts a matched Last.fm result and performs one request per tap',async()=>{
  const oldFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json({track:{title:'Only for the Weak',artist:'In Flames',album:'Clayman',libraryTrackId:'TR9',duration_s:294,plays:22,image:'https://lastfm-img.freetls.fastly.net/i/u/300x300/cover.jpg'},checkedAt:new Date().toISOString()});};
  try {
    const result=await app.loadNowPlaying();assert.equal(result.libraryTrackId,'TR9');assert.equal(calls.length,1);
    await app.loadNowPlaying();assert.equal(calls.length,2);
  } finally {globalThis.fetch=oldFetch;}
});

test('only current library artists above exactly 30 minutes qualify, without rounding',()=>{
  const tracks=[track('At boundary',1800,1),track('Above boundary',1801,1),track('Below',1799,1),track('Combined',900,1),track('Combined',901,1),track('Removed',5000,1,{in_library:0}),track('Canonical',1900,1,{album_artist:'Album artist'})];
  assert.deepEqual(app.libraryArtists(tracks).map(a=>a.name),['Album artist','Above boundary','Combined']);
});
test('all-time listening includes archived tracks, but discovery requires a current library artist',()=>{
  assert.deepEqual(app.libraryArtists([track('Band',10,1),track('Band',1800,1,{in_library:0,album:'Archived'})]),[{name:'Band',albums:['Known album']}]);
});
test('lyrics match artist/title and custom version suffix, preferring the correct album',()=>{
  const song=track('Band',320,1,{title:'A Song 2.1 (2026 Remaster)'});
  const rows=[{artistName:'Other band',trackName:'A Song',plainLyrics:'Wrong artist'},{artistName:'Band',trackName:'Other Song',plainLyrics:'Wrong title'}, {artistName:'Band',trackName:'A Song',albumName:'Other',plainLyrics:'Version one'},{artistName:'Band',trackName:'A Song',albumName:'Known album',plainLyrics:'Version two'}];
  assert.equal(app.chooseLyrics(song,rows).plainLyrics,'Version two');
  assert.equal(app.chooseLyrics(song,rows.slice(0,2)),undefined);
});
test('date ranges preserve partial dates and reject impossible dates',()=>{
  assert.equal(app.upcomingDate('2026-10','2026-10-03','2027-10-03'),true);
  assert.equal(app.upcomingDate('2026-09-30','2026-10-03','2027-10-03'),false);
  assert.equal(app.dateBounds('2026-02-30'),null);
  assert.equal(app.dateBounds('2026-13'),null);
  assert.deepEqual(app.dateBounds('2024-02'),{lo:'2024-02-01',hi:'2024-02-29'});
  assert.equal(app.releasePhase('2026-10-03','2026-10-03'),'recent');
  assert.equal(app.releasePhase('2026-10','2026-10-03'),'unknown');
  assert.equal(app.releasePhase('2026','2026-10-03'),'unknown');
  assert.equal(app.releasePhase('2026-09','2026-10-03'),'recent');
  assert.equal(app.releasePhase('2026-11','2026-10-03'),'upcoming');
  assert.equal(app.releaseDate('2026-10'),'Tháng 10/2026');
});
test('release feed verifies artist identity, includes singles/live, and marks owned albums',async()=>{
  const good='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',wrong='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const group=(id,artist,date,title,primary='Album',secondary=[])=>({id,title,'artist-credit':[{artist:{id:artist,name:'Band'}}],'first-release-date':date,'primary-type':primary,'secondary-types':secondary});
  const cache=store(), requests=[];
  const fetcher=async url=>{const q=new URL(url).searchParams.get('query');requests.push(q);
    if(q.startsWith('arid:')) return Response.json({count:1,'release-groups':q.includes(good)?[{title:'Known album'}]:[]});
    return Response.json({count:5,'release-groups':[group('11111111-1111-1111-1111-111111111111',good,'2026-09-30','Known album'),group('22222222-2222-2222-2222-222222222222',good,'2026-10-16','Future single','Single'),group('33333333-3333-3333-3333-333333333333',wrong,'2026-10-09','Namesake'),group('44444444-4444-4444-4444-444444444444',good,'2026-11','Live show','Album',['Live']),group('55555555-5555-5555-5555-555555555555',good,'2020-01-01','Old album')]});};
  const result=await app.musicBrainzUpcoming([track('Band',1801,1)],'0~0',cache,fetcher,'2026-10-03');
  assert.equal(result.rows.length,3);assert.equal(result.unverified,1);assert.equal(result.next,null);assert.equal(result.rows[0].owned,true);
  assert.deepEqual(result.rows.map(r=>r.type),['Album','Single','Live']);
  assert.equal(requests.length,3);
  await app.musicBrainzUpcoming([track('Band',1801,1)],'0~0',cache,fetcher,'2026-10-03');
  assert.equal(requests.length,3,'repeated requests should use cached source data');
});
test('paging scans only eligible artists and returns explicit completion',async()=>{
  const tracks=Array.from({length:9},(_,i)=>track('Band '+i,2000,1));
  const fetcher=async()=>Response.json({count:0,'release-groups':[]});
  const first=await app.musicBrainzUpcoming(tracks,'0~0',store(),fetcher,'2026-10-03');
  assert.equal(first.checked,8);assert.equal(first.total,9);assert.equal(first.next,'8~0');
  const second=await app.musicBrainzUpcoming(tracks,first.next,store(),fetcher,'2026-10-03');
  assert.equal(second.checked,9);assert.equal(second.next,null);
});
test('a source outage is not cached as missing lyrics and a 429 respects cooldown',async()=>{
  const cache=store();let calls=0;
  const fetcher=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});};
  await assert.rejects(()=>app.lyrics(track('Band',300,1),cache,fetcher),e=>e.retryAfter===60);
  await assert.rejects(()=>app.lyrics(track('Band',300,1),cache,fetcher));
  assert.equal(calls,1);assert.equal([...cache.cache.keys()].some(k=>k.startsWith('source:')),false);
});
test('malformed source results are rejected before caching',async()=>{
  const cache=store();await assert.rejects(()=>app.lyrics(track('Band',300,1),cache,async()=>Response.json({error:'temporary'})));
  assert.equal(cache.cache.size,0);
});
test('Apple Music links match both album and artist, preserving edition qualifiers',()=>{
  const album=(artistName,collectionName,collectionViewUrl='https://music.apple.com/vn/album/title/123?uo=4')=>({artistName,collectionName,collectionViewUrl,collectionType:'Album'});
  const correct=album('Band','New Release - EP');
  assert.equal(app.chooseAppleAlbum('Band','New Release',[album('Other band','New Release'),album('Band','New Release (Live)'),correct]),correct);
  assert.equal(app.chooseAppleAlbum('Band','New Release (Deluxe)',[correct]),undefined);
  assert.equal(app.chooseAppleAlbum('Band','New Release',[album('Band','New Release','https://music.apple.com.evil.test/vn/album/title/123')]),undefined);
  assert.equal(app.appleMusicUrl(correct.collectionViewUrl),'https://music.apple.com/vn/album/title/123');
  assert.equal(app.appleMusicUrl('https://music.apple.com/us/album/title/123'),'https://music.apple.com/us/album/title/123');
});
test('Apple album lookup uses VN, caches searches, and falls back without choosing a wrong album',async()=>{
  const cache=store();let calls=0;
  const fetcher=async url=>{calls++;const q=new URL(url).searchParams;assert.equal(q.get('country'),'vn');assert.equal(q.get('entity'),'album');return Response.json({resultCount:1,results:[{collectionType:'Album',artistName:'Band',collectionName:'New Release',collectionViewUrl:'https://music.apple.com/vn/album/new-release/123?uo=4'}]});};
  assert.deepEqual(await app.resolveAppleAlbum('Band','New Release',cache,fetcher),{status:'found',url:'https://music.apple.com/vn/album/new-release/123'});
  await app.resolveAppleAlbum('Band','New Release',cache,fetcher);assert.equal(calls,1);
  const result=await app.resolveAppleAlbum('Band','Future & Album',store(),async()=>Response.json({resultCount:0,results:[]}));
  assert.equal(result.status,'search');assert.equal(new URL(result.url).searchParams.get('term'),'Band Future & Album');
});
test('Apple rate limits fall back to search without caching a missing album',async()=>{
  const cache=store();
  const result=await app.resolveAppleAlbum('Band','Album',cache,async()=>new Response('',{status:503,headers:{'Retry-After':'60'}}));
  assert.equal(result.status,'search');assert.equal(result.reason,'unavailable');
  assert.equal([...cache.cache.keys()].some(k=>k.startsWith('source:')),false);
});
test('verified MusicBrainz album links avoid Apple search and prefer the VN storefront',async()=>{
  let calls=0;
  const row=(artist,url)=>({title:'Album','artist-credit':[{artist:{name:artist}}],relations:[{url:{resource:url}}]});
  const fetcher=async url=>{calls++;assert.equal(new URL(url).hostname,'musicbrainz.org');return Response.json({'release-count':3,releases:[row('Wrong band','https://music.apple.com/vn/album/999'),row('Band','https://music.apple.com/nl/album/123'),row('Band','https://music.apple.com/vn/album/123')]});};
  const result=await app.resolveAppleAlbum('Band','Album',store(),fetcher,'11111111-1111-1111-1111-111111111111');
  assert.deepEqual(result,{status:'found',url:'https://music.apple.com/vn/album/123'});assert.equal(calls,1);
});
test('iPhone and iPad use the Music app scheme while preserving album and song identifiers',()=>{
  const link='https://music.apple.com/fi/album/netherworlds/6789116125?i=6789116417';
  assert.equal(app.appleMusicTarget(link,{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}),'musics://music.apple.com/fi/album/netherworlds/6789116125?i=6789116417');
  assert.equal(app.appleMusicTarget(link,{userAgent:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',maxTouchPoints:5}).startsWith('musics:'),true);
  assert.equal(app.appleMusicTarget(link,{userAgent:'Mozilla/5.0 (Linux; Android 15)'}),link);
});
test('Music app search preserves encoded artist/title and refuses foreign destinations',()=>{
  const link='https://music.apple.com/vn/search?term=T%C3%BDr+%26+Album';
  assert.equal(app.appleMusicTarget(link,{userAgent:'iPhone'}),'musics://music.apple.com/vn/search?term=T%C3%BDr+%26+Album');
  for(const url of ['https://music.apple.com.evil.test/vn/album/123','https://user:pass@music.apple.com/vn/album/123','javascript:alert(1)','https://music.apple.com/vn/artist/123']) {
    assert.throws(()=>app.appleMusicTarget(url,{userAgent:'iPhone'}));
  }
});
test('external Music open calls the native bridge synchronously in the tap, without web navigation',async()=>{
  let called=false;
  const result=app.requestAppleMusicOpen('https://music.apple.com/vn/album/123',{userAgent:'iPhone'},({url})=>{
    called=true;assert.equal(url,'musics://music.apple.com/vn/album/123');return Promise.resolve();
  });
  assert.equal(called,true,'must call before the handler returns, preserving the tap gesture');
  await result;
});
test('native rejection and missing callbacks return control for manual opening',async()=>{
  const link='https://music.apple.com/vn/album/123',device={userAgent:'iPhone'};
  await assert.rejects(app.requestAppleMusicOpen(link,device,()=>Promise.reject(new Error('unsupported'))),/unsupported/);
  await assert.rejects(app.requestAppleMusicOpen(link,device,()=>new Promise(()=>{}),10),/external_open_timeout/);
  await assert.rejects(app.requestAppleMusicOpen(link,device,()=>{throw Error('bridge unavailable');}),/bridge unavailable/);
});
test('opening diagnostics retain numeric SDK codes without exposing native payloads',()=>{
  assert.equal(app.appleMusicOpenError({code:-1401,message:'private payload',accessToken:'private'}),'AM5:ERR:-1401');
  assert.equal(app.appleMusicOpenError({code:'private payload'}),'AM5:ERR');
  assert.equal(app.appleMusicOpenError(new Error('external_open_timeout')),'AM5:TIMEOUT');
  assert.equal(app.appleMusicOpenError(null),'AM5:ERR');
});
test('system sharing receives the HTTPS album URL immediately with its navigator receiver',async()=>{
  let called=false;
  const target={share(data){assert.equal(this,target);assert.deepEqual(data,{url:'https://music.apple.com/vn/album/123'});called=true;return Promise.resolve();}};
  const result=app.shareAppleMusicLink('https://music.apple.com/vn/album/123',target);
  assert.equal(called,true);
  await result;
  assert.throws(()=>app.shareAppleMusicLink('https://example.com/album/123',target));
});
test('song links preserve the track ID and reject album-only or mismatched editions',()=>{
  const q={kind:'song',artist:'Band',title:'Song',album:'Album'};
  const row={kind:'song',artistName:'Band',trackName:'Song',collectionName:'Album',trackViewUrl:'https://music.apple.com/vn/album/album/123?i=456&uo=4'};
  assert.equal(app.chooseAppleDetail(q,[{...row,artistName:'Other'},row]),'https://music.apple.com/vn/album/album/123?i=456');
  for(const bad of [{...row,collectionName:'Album (Live)'},{...row,trackName:'Song (Live)'},{...row,trackViewUrl:'https://music.apple.com/vn/album/123'}])assert.equal(app.chooseAppleDetail(q,[bad]),null);
  assert.equal(app.chooseAppleDetail(q,[row,{...row,trackViewUrl:'https://music.apple.com/vn/song/789'}]),null);
});
test('artist links require a matching name and avoid ambiguous namesakes',()=>{
  const q={kind:'artist',artist:'MONO'};
  const row={wrapperType:'artist',artistName:'MONO',artistLinkUrl:'https://music.apple.com/vn/artist/mono/123?uo=4'};
  assert.equal(app.chooseAppleDetail(q,[{...row,artistName:'Other'},row]),'https://music.apple.com/vn/artist/mono/123');
  assert.equal(app.chooseAppleDetail(q,[row,{...row,artistLinkUrl:'https://music.apple.com/vn/artist/mono/456'}]),null);
  assert.equal(app.chooseAppleDetail(q,[{...row,artistLinkUrl:'https://music.apple.com.evil.test/vn/artist/123'}]),null);
});
test('detail lookup requests the right entity and source failures retain a useful search link',async()=>{
  for(const kind of ['song','artist']) {
    const q={kind,artist:'Týr',...(kind==='song'?{title:'The Edge'}:{})};
    const result=await app.resolveAppleDetail(q,store(),async url=>{
      assert.equal(new URL(url).searchParams.get('entity'),kind==='song'?'song':'musicArtist');
      return Response.json({resultCount:0,results:[]});
    });
    assert.equal(result.status,'search');
    assert.equal(new URL(result.url).searchParams.get('term'),kind==='song'?'Týr The Edge':'Týr');
  }
  const result=await app.resolveAppleDetail({kind:'artist',artist:'Band'},store(),async()=>new Response('',{status:503}));
  assert.equal(result.reason,'unavailable');
});
test('system sharing accepts artist and song links without stripping the selected song',async()=>{
  for(const url of ['https://music.apple.com/vn/artist/mono/123','https://music.apple.com/vn/album/123?i=456','https://music.apple.com/vn/song/456']) {
    let called=false;
    const target={share(data){called=true;assert.equal(this,target);assert.deepEqual(data,{url});return Promise.resolve();}};
    const result=app.shareAppleMusicLink(url,target);assert.equal(called,true);await result;
  }
});
test('unmatched recent songs get an album year only from an exact catalog match',async()=>{
  const q={kind:'song',artist:'Band',title:'Song',album:'Album (Expanded Edition)'};
  const row={kind:'song',artistName:'Band',trackName:'Song',collectionName:q.album,trackViewUrl:'https://music.apple.com/vn/album/123?i=456',releaseDate:'1995-11-14T12:00:00Z'};
  const resolve=rows=>app.resolveAppleDetail(q,store(),async()=>Response.json({resultCount:rows.length,results:rows}));
  assert.equal((await resolve([row])).releaseYear,1995);
  for(const edit of [{collectionName:'Other Album'},{artistName:'Other'},{releaseDate:'invalid'}])assert.equal((await resolve([{...row,...edit}])).releaseYear,undefined);
  assert.equal((await resolve([row,{...row,releaseDate:'2000-01-01T12:00:00Z'}])).releaseYear,undefined);
});

const mbEdition=(id,extra={})=>({id,title:'Album',status:'Official','artist-credit':[{name:'Band'}],media:[{position:1,format:'Digital Media','track-count':2,tracks:[{id:'b',title:'Second',position:2,length:120000},{id:'a',title:'First',position:1,length:null}]},{position:2,'track-count':1,tracks:[{id:'c',recording:{title:'Third',length:60000},position:1}]}],...extra});
test('album catalog selects one complete official edition, preserves disc order and unknown duration',()=>{
  const data=app.musicBrainzAlbumTracks('Band','Album',[mbEdition('wrong',{title:'Album (Deluxe)'}),mbEdition('boot',{status:'Bootleg'}),mbEdition('correct')]);
  assert.deepEqual(data.tracks.map(t=>[t.title,t.disc,t.trackNumber,t.duration_s]),[['First',1,1,undefined],['Second',1,2,120],['Third',2,1,60]]);
  assert.ok(data.sourceUrl.endsWith('/correct'));
  assert.equal(app.musicBrainzAlbumTracks('Other','Album',[mbEdition('x')]),null);
  assert.equal(app.musicBrainzAlbumTracks('Band','Album',[mbEdition('x',{media:[{position:1,'track-count':12,tracks:[]}]})]),null);
});
test('album catalog uses a MusicBrainz identity and never calls iTunes',async()=>{
  const calls=[];
  const group='11111111-1111-1111-1111-111111111111';
  const mb=await app.albumTracks('Band','Album',group,store(),async url=>{calls.push(String(url));return Response.json({'release-count':1,releases:[mbEdition('x')]});});
  assert.equal(mb.tracks.length,3);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0]).searchParams.get('release-group'),group);
  assert.ok(calls.every(url=>new URL(url).hostname==='musicbrainz.org'));
});
test('album catalog can find an unlinked album by an unambiguous MusicBrainz search',async()=>{
  const calls=[],group='11111111-1111-1111-1111-111111111111';
  const result=await app.albumTracks('Band','Album',undefined,store(),async url=>{
    calls.push(String(url));const u=new URL(url);
    return u.pathname.includes('release-group')
      ? Response.json({count:1,'release-groups':[{id:group,title:'Album','artist-credit':[{artist:{name:'Band'}}]}]})
      : Response.json({'release-count':1,releases:[mbEdition('x')]});
  });
  assert.equal(result.source,'MusicBrainz');assert.equal(result.tracks.length,3);assert.equal(calls.length,2);
  assert.ok(calls.every(url=>new URL(url).hostname==='musicbrainz.org'));
});
test('Bandcamp adds verified releases and supplies a full album without iTunes',async()=>{
  const cache=store(),calls=[],mbid='11111111-1111-1111-1111-111111111111';
  const fetcher=async (url,init)=>{
    const u=new URL(url);calls.push(u);
    if(u.hostname==='musicbrainz.org' && u.pathname.includes('/artist/') && !u.pathname.includes(mbid))return Response.json({count:1,artists:[{id:mbid,name:'Atavistia'}]});
    if(u.hostname==='musicbrainz.org' && u.pathname.includes('/release-group/'))return Response.json({count:1,'release-groups':[{title:'Cosmic Warfare'}]});
    if(u.hostname==='musicbrainz.org')return Response.json({id:mbid,relations:[{type:'bandcamp',url:{resource:'https://atavistia.bandcamp.com/'}}]});
    if(u.pathname.includes('autocomplete_elastic')){
      const filter=JSON.parse(init.body).search_filter;
      return Response.json({auto:{results:filter==='b'
        ? [{type:'b',id:481226832,name:'Atavistia',item_url_root:'https://atavistia.bandcamp.com'}]
        : [{type:'a',id:3660736728,band_id:481226832,name:'Old Gods Awaken (Deluxe Edition)',band_name:'Atavistia',item_url_root:'https://atavistia.bandcamp.com',item_url_path:'https://atavistia.bandcamp.com/album/old-gods-awaken-deluxe-edition'}]}});
    }
    if(u.pathname.includes('band_details'))return Response.json({id:481226832,name:'Atavistia',discography:[{item_type:'album',item_id:3660736728,band_id:481226832,title:'Old Gods Awaken (Deluxe Edition)',band_name:'Atavistia',release_date:'09 Oct 2026 00:00:00 GMT',art_id:3521283449}]});
    if(u.hostname==='atavistia-bandcamp-com.translate.goog'){
      const prop=(name,value)=>({'@type':'PropertyValue',name,value});
      const schema={'@type':'MusicAlbum','@id':'https://atavistia.bandcamp.com/album/old-gods-awaken-deluxe-edition',name:'Old Gods Awaken (Deluxe Edition)',
        albumRelease:[{additionalProperty:[prop('item_id',3660736728),prop('selling_band_id',481226832)]}],byArtist:{name:'Atavistia'},
        track:{numberOfItems:2,itemListElement:[{position:1,item:{name:'First',duration:'P00H06M24S',additionalProperty:[prop('track_id',123)]}},{position:2,item:{name:'Second',duration:'P00H04M01S',additionalProperty:[prop('track_id',124)]}}]}};
      return new Response(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
    }
    throw new Error('Bandcamp album page should supply the track list');
  };
  const release=await app.bandcampReleases({name:'Atavistia',albums:['Cosmic Warfare']},'2026-07-01','2027-10-03',cache,fetcher);
  assert.equal(release.rows.length,1);assert.equal(release.rows[0].id,'bandcamp:album:3660736728');assert.equal(release.rows[0].date,'2026-10-09');
  const album=await app.albumTracks('Atavistia','Old Gods Awaken (Deluxe Edition)',release.rows[0].id,cache,fetcher);
  assert.equal(album.source,'Bandcamp');assert.deepEqual(album.tracks.map(row=>[row.title,row.duration_s]),[['First',384],['Second',241]]);
  assert.ok(calls.every(url=>url.hostname!=='itunes.apple.com'));
});
test('Bandcamp mobile JSON uses its JSON bridge when Cloudflare receives HTML',async()=>{
  const cache=store(),calls=[];
  const payload={id:481226832,name:'Atavistia',discography:[]};
  const result=await app.sourceJson('https://api.bandcamp.com/api/mobile/24/band_details?band_id=481226832','bandcamp',cache,async url=>{
    const host=new URL(url).hostname;calls.push(host);
    return host.endsWith('.translate.goog')
      ? Response.json(payload)
      : new Response('<!DOCTYPE html><title>blocked</title>',{headers:{'content-type':'text/html'}});
  });
  assert.equal(result.id,481226832);
  assert.deepEqual(calls,['api.bandcamp.com','api-bandcamp-com.translate.goog']);
  assert.deepEqual(await cache.get('bandcamp-proxy:v1'),{enabled:true});
});
test('MusicBrainz and Bandcamp copies merge into one release and prefer Bandcamp metadata',()=>{
  const mb={id:'11111111-1111-1111-1111-111111111111',title:'Album',artist:'Band',date:'2026-10-09',type:'Album',owned:false,url:'https://musicbrainz.org/release-group/11111111-1111-1111-1111-111111111111',cover:'',sources:['MusicBrainz']};
  const bc={...mb,id:'bandcamp:album:1',url:'https://band.bandcamp.com/album/album',cover:'https://f4.bcbits.com/img/a1_10.jpg',sources:['Bandcamp']};
  const merged=app.mergeReleases([mb,bc]);assert.equal(merged.length,1);assert.equal(merged[0].id,bc.id);assert.deepEqual(merged[0].sources,['MusicBrainz','Bandcamp']);
});

test('Melodeath in the current library bypasses 30 minutes; removed tracks and other genres do not',()=>{
  const rows=[track('Melodeath',300,0,{genre:'Melodeath metal'}),track('Other',300,1,{genre:'Power metal'}),track('Removed',300,0,{genre:'Melodeath metal',in_library:0}),track('Removed',300,0,{genre:'Rock'}),track('Album band',300,0,{album_artist:'Canonical',genre:'MELODEATH METAL'})];
  assert.deepEqual(app.libraryArtists(rows).map(a=>a.name),['Canonical','Melodeath']);
});
const appleAlbum=(extra={})=>({wrapperType:'collection',collectionType:'Album',artistName:'Atavistia',artistId:1287070679,collectionId:6805550996,collectionName:'Old Gods Awaken (Deluxe Edition)',releaseDate:'2026-10-09T07:00:00Z',trackCount:16,collectionViewUrl:'https://music.apple.com/vn/album/old-gods-awaken-deluxe-edition/6805550996?uo=4',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/test/100x100bb.jpg',...extra});
test('MusicBrainz outage retains a retry cursor and never calls iTunes',async()=>{
  const tracks=Array.from({length:9},(_,i)=>track('Band '+i,2000,1));
  const calls=[],result=await app.upcoming(tracks,'0~0',store(),async url=>{calls.push(String(url));return new Response('',{status:503});},'2026-10-03');
  assert.equal(result.next,'b:0~0');assert.equal(result.failed.source,'MusicBrainz');assert.equal(result.failed.cursor,'0~0');
  assert.ok(calls.length>0);assert.ok(calls.every(url=>new URL(url).hostname==='musicbrainz.org'));
});
test('legacy Apple cursors skip to the next MusicBrainz batch without calling iTunes',async()=>{
  const tracks=Array.from({length:9},(_,i)=>track('Band '+i,2000,1)),calls=[];
  const result=await app.upcoming(tracks,'i:0~3',store(),async url=>{calls.push(String(url));return Response.json({count:0,'release-groups':[]});},'2026-10-03');
  assert.equal(result.checked,8);assert.equal(result.next,'b:8~0');
  assert.ok(calls.every(url=>new URL(url).hostname==='musicbrainz.org'));
  assert.equal(app.validReleaseCursor('i:0~3'),false);
});
test('direct Apple album identities resolve without passing them to MusicBrainz',async()=>{
  const result=await app.resolveAppleAlbum('Atavistia','Old Gods Awaken (Deluxe Edition)',store(),async url=>{
    assert.equal(new URL(url).hostname,'itunes.apple.com');assert.equal(new URL(url).searchParams.get('id'),'6805550996');return Response.json({resultCount:1,results:[appleAlbum()]});
  },'itunes:vn:6805550996');
  assert.equal(result.status,'found');assert.match(result.url,/6805550996$/);
  assert.equal(app.validAlbumId('itunes:vn:6805550996'),true);assert.equal(app.validAlbumId('itunes:../../evil'),false);
});
test('pagination completes MusicBrainz batches for every artist exactly once',async()=>{
  const tracks=Array.from({length:9},(_,i)=>track('Band '+i,2000,1));
  const hosts=[],fetcher=async url=>{hosts.push(new URL(url).hostname);return Response.json({count:0,'release-groups':[]});};
  const seen=[],cache=store();let cursor='0~0',last;
  while(cursor!==null){assert.ok(!seen.includes(cursor));seen.push(cursor);last=await app.upcoming(tracks,cursor,cache,fetcher,'2026-10-03');cursor=last.next;}
  assert.deepEqual(seen,['0~0',...Array.from({length:8},(_,i)=>`b:0~${i}`),'8~0','b:8~0']);assert.ok(hosts.every(host=>host==='musicbrainz.org'));
  assert.equal(last.checked,9);assert.equal(last.total,9);
});
test('an artist search loads Nightwish directly without waiting for its alphabetical scan position',async()=>{
  const tracks=[...Array.from({length:20},(_,i)=>track('Artist '+i,2000,1)),track('Nightwish',2000,1)];
  const requested=[];
  const fetcher=async url=>{
    const u=new URL(url);requested.push(u);
    if(u.hostname==='musicbrainz.org'){
      if(u.pathname.includes('/artist/'))return Response.json({count:0,artists:[]});
      const q=u.searchParams.get('query');assert.ok(!q.includes('Artist '));
      return Response.json(q.startsWith('arid:')?{count:1,'release-groups':[{title:'Known album'}]}:{count:1,'release-groups':[{id:'dc19ed51-3c78-441c-9375-2e86fb647357',title:'The Greatest 30 Years on Earth','primary-type':'Album','secondary-types':['Live'],'first-release-date':'2026-12-11','artist-credit':[{artist:{id:'nightwish',name:'Nightwish'}}]}]});
    }
    return Response.json({resultCount:0,results:[]});
  };
  const result=await app.artistUpcoming(tracks,'Nightwish',store(),fetcher,'2026-10-03');
  assert.equal(result.artist,'Nightwish');assert.equal(result.rows[0].date,'2026-12-11');assert.equal(result.rows[0].title,'The Greatest 30 Years on Earth');assert.deepEqual(result.failed,[]);
  assert.ok(requested.length>0);assert.ok(!('next' in result),'priority result must not change background scan cursor');
});
test('targeted searches preserve library eligibility and avoid ambiguous artist fragments',async()=>{
  const rows=[track('Nightwish',2000,1),track('Nightfall',2000,1),track('Excluded',30,1)];
  const fetcher=async()=>{throw Error('No source should be called');};
  for(const q of ['Night','Excluded','Unknown']){
    const result=await app.artistUpcoming(rows,q,store(),fetcher,'2026-10-03');assert.equal(result.artist,null);assert.deepEqual(result.rows,[]);assert.deepEqual(result.failed,[]);
  }
});
test('priority lookup reports both source failures and makes no iTunes request',async()=>{
  const calls=[];
  const result=await app.artistUpcoming([track('Atavistia',2000,1,{album:'Cosmic Warfare'})],'Atavistia',store(),async url=>{calls.push(String(url));return new Response('',{status:503});},'2026-10-03');
  assert.deepEqual(result.rows,[]);assert.deepEqual(result.failed,['MusicBrainz','Bandcamp']);
  assert.ok(calls.every(url=>new URL(url).hostname==='musicbrainz.org'));
});

 test('release scan prioritizes all-time listening duration, including archived plays, with stable ties',()=>{
   const tracks=[track('Alphabet first',2000,1),track('Top artist',100,1),track('Top artist',3000,10,{in_library:0}),track('Tie B',2000,1),track('Melodeath',10,1,{genre:'Melodeath metal'})];
   assert.deepEqual(app.libraryArtists(tracks).map(a=>a.name),['Top artist','Alphabet first','Tie B','Melodeath']);
 });
 test('manual exclusions override listening totals and Melodeath exception using canonical album artist',async()=>{
   const tracks=[track('Alias',2000,20,{album_artist:'Týr',genre:'Melodeath metal'}),track('Keep',2000,1)];
   const filtered=app.releaseTracks(tracks,['TYR']);
   assert.deepEqual(app.libraryArtists(filtered).map(a=>a.name),['Keep']);
   const result=await app.artistUpcoming(filtered,'Týr',store(),()=>{throw Error('Excluded artist must never request a source');},'2026-10-03');
   assert.equal(result.artist,null);
   assert.deepEqual(app.libraryArtists(app.releaseTracks(tracks,[])).map(a=>a.name),['Týr','Keep']);
 });

test('library song lookup removes only personal version suffixes and keeps the song ID',async()=>{
  const row={kind:'song',artistName:'Wintersun',trackName:'Sleeping Stars',collectionName:'Wintersun',trackViewUrl:'https://music.apple.com/vn/album/sleeping-stars/1456964736?i=1456965022&uo=4'};
  const q={kind:'song',artist:'Wintersun',title:'Sleeping Stars 1.1',album:'Wintersun 2.0',libraryTitle:true};
  const result=await app.resolveAppleDetail(q,store(),async url=>{
    assert.equal(new URL(url).searchParams.get('term'),'Wintersun Sleeping Stars');
    return Response.json({resultCount:1,results:[row]});
  });
  assert.equal(result.status,'found');
  assert.equal(result.url,'https://music.apple.com/vn/album/sleeping-stars/1456964736?i=1456965022');
  const live=await app.resolveAppleDetail({...q,title:'Sleeping Stars 1.1 (Live)'},store(),async()=>Response.json({resultCount:1,results:[row]}));
  assert.equal(live.status,'search');
  const external=await app.resolveAppleDetail({...q,libraryTitle:false},store(),async()=>Response.json({resultCount:1,results:[row]}));
  assert.equal(external.status,'search');
});

test('song lookup tries US catalog and sharing never sends search URLs',async()=>{
  const url='https://music.apple.com/us/album/only-for-the-weak/1497661695?i=1497661836';
  const countries=[];
  const result=await app.resolveAppleDetail({kind:'song',artist:'In Flames',title:'Only for the Weak'},store(),async target=>{
    const country=new URL(target).searchParams.get('country');countries.push(country);
    const results=country==='us'?[{kind:'song',artistName:'In Flames',trackName:'Only for the Weak',trackViewUrl:url}]:[];
    return Response.json({resultCount:results.length,results});
  });
  assert.deepEqual(countries,['vn','us']); assert.equal(result.url,url);
  let shared;
  await app.shareAppleMusicLink(result.url,{share(data){shared=data;return Promise.resolve();}});
  assert.deepEqual(shared,{url});
  assert.throws(()=>app.shareAppleMusicLink('https://music.apple.com/vn/search?term=Only+for+the+Weak',{share(){assert.fail('search must not be shared');}}));
});

test('Apple cooldown uses the independent reader instead of calling iTunes directly',async()=>{
  const cache=store();await cache.put('cooldown:itunes',{seconds:60});const calls=[];
  const result=await app.sourceJson('https://itunes.apple.com/search?term=Band','itunes',cache,async target=>{
    calls.push(String(target));assert.equal(new URL(target).hostname,'music.apple.com');
    return applePage([{itemKind:'artists',title:'Band',contentDescriptor:{url:'https://music.apple.com/vn/artist/band/123'}}]);
  });
  assert.equal(result.resultCount,1);assert.equal(calls.length,1);
});

test('Apple reader remains available when the first bridge is down',async()=>{
  const cache=store();await cache.put('cooldown:itunes',{seconds:60});const hosts=[];
  const result=await app.sourceJson('https://itunes.apple.com/search?term=Band','itunes',cache,async target=>{
    const host=new URL(target).hostname;hosts.push(host);
    if(host==='music.apple.com'||host.endsWith('translate.goog'))return new Response('',{status:503});
    return new Response('Title: \n\nMarkdown Content:\n\n'+JSON.stringify({resultCount:0,results:[]}));
  });
  assert.equal(result.resultCount,0);assert.deepEqual(hosts,['music.apple.com','itunes-apple-com.translate.goog','r.jina.ai']);
});

test('song lookup resolves an exact Apple Music URL through the reader after a direct 429',async()=>{
  const cache=store(),calls=[];
  const q={kind:'song',artist:'In Flames',title:'Only for the Weak',album:'Clayman'};
  const row={kind:'song',artistName:q.artist,trackName:q.title,collectionName:q.album,trackViewUrl:'https://music.apple.com/vn/album/only-for-the-weak/1497661695?i=1497661836&uo=4'};
  const result=await app.resolveAppleDetail(q,cache,async target=>{
    const host=new URL(target).hostname;calls.push(String(target));
    if(host==='itunes.apple.com')return new Response('',{status:429,headers:{'Retry-After':'60'}});
    if(host==='music.apple.com')return applePage([
      {itemKind:'songs',title:q.title,subtitle:'Song · '+q.artist,contentDescriptor:{url:row.trackViewUrl}},
      {itemKind:'albums',title:q.album,subtitle:'Album · '+q.artist,contentDescriptor:{url:'https://music.apple.com/vn/album/clayman/1497661695'}},
    ]);
    return new Response('',{status:503});
  });
  assert.equal(result.status,'found');assert.equal(result.url,'https://music.apple.com/vn/album/only-for-the-weak/1497661695?i=1497661836');
  assert.deepEqual(calls.map(url=>new URL(url).hostname),['itunes.apple.com','music.apple.com']);
});

test('resolved Apple song links survive source-cache expiration and an Apple outage',async()=>{
 const cache=store(),q={kind:'song',artist:'Band',title:'Song',album:'Album'};
 const url='https://music.apple.com/vn/album/song/123?i=456';
 const first=await app.resolveAppleDetail(q,cache,async()=>Response.json({resultCount:1,results:[{kind:'song',artistName:'Band',trackName:'Song',collectionName:'Album',trackViewUrl:url}]}));
 for(const key of cache.cache.keys())if(key.startsWith('source:'))cache.cache.delete(key);
 await cache.put('cooldown:itunes',{seconds:60});
 const later=await app.resolveAppleDetail(q,cache,async()=>assert.fail('must use verified URL during outage'));
 assert.equal(first.url,url);assert.equal(later.url,url);
 const other=await app.resolveAppleDetail({...q,album:'Album (Live)'},cache,async()=>new Response('',{status:503}));
 assert.notEqual(other.status,'found');
});

test('library remaster suffix omission is allowed only on the exact requested album',()=>{
 const q={kind:'song',artist:'MONO',title:'Burial at Sea',album:'Hymn to the Immortal Wind – Anniversary Edition',libraryTitle:true};
 const row={kind:'song',artistName:'MONO',trackName:'Burial at Sea (Remastered)',collectionName:'Hymn to the Immortal Wind (Anniversary Edition)',trackViewUrl:'https://music.apple.com/vn/album/burial-at-sea-remastered/318889559?i=318889599'};
 assert.equal(app.chooseAppleDetail(q,[row]),row.trackViewUrl);
 assert.equal(app.chooseAppleDetail({...q,libraryTitle:false},[row]),null);
 assert.equal(app.chooseAppleDetail({...q,album:undefined},[row]),null);
 assert.equal(app.chooseAppleDetail({...q,album:'Another edition'},[row]),null);
 assert.equal(app.chooseAppleDetail({...q,title:'Burial at Sea (2026 Remaster)'},[row]),null);
 assert.equal(app.chooseAppleDetail(q,[{...row,trackName:'Burial at Sea (Live)'}]),null);
 assert.equal(app.chooseAppleDetail(q,[row,{...row,trackViewUrl:'https://music.apple.com/vn/album/another/789?i=790'}]),null);
});
