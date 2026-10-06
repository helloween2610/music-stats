import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/lib/album-groups'; export * from './src/lib/albums'; export * from './src/lib/album-ranking'; export {AlbumScreen} from './src/screens/album'; export {rememberParent,parentPage} from './src/lib/navigation'; export {pathOf} from './src/state'; export {applyArtworkRanks} from './src/lib/artwork-ranks'; export {appleDetailSearch,loadAppleDetail,rememberReleaseAlbum,findReleaseAlbum} from './src/lib/discovery'; export {buildVM} from './src/vm'; export {BASE} from './src/state'; export {invalidate} from './src/lib/api'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{}}};
const app=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const row=(id,title,disc,trackNumber,extra={})=>({id,title,album_artist:'Band',artist:'Guest',album:'Shared / Title',duration_s:300,year:2001,in_library:1,library_metadata:JSON.stringify({disc,trackNumber,trackCount:2}),...extra});
const rows=[row('TR3','Third',2,1),row('TR2','Second',1,2),row('TR1','First',1,1),row('TR4','Other artist',1,1,{album_artist:'Other'}),row('TR5','Other edition',1,1,{album:'Shared / Title (Live)'})];
const stats={rows:[{track_id:'TR1',plays:3},{track_id:'TR2',plays:0},{track_id:'TR3',plays:2}]};
const id=app.albumId('Band','Shared / Title');
const view=(go=()=>{})=>app.albumView(id,rows,stats,{},[{album_artist:'Band',album:'Shared / Title',rank:12}],{albums:{'Band\u001fShared / Title':'https://example.com/cover.jpg'}},'2026-10-03',go);
test('album identity preserves artist, edition, accents and slashes through routes',()=>{
  const value=app.albumId('Týr','Album / "Deluxe"');
  assert.deepEqual(app.parseAlbumId(decodeURIComponent(app.pathOf('album',value).slice('/album/'.length))),{artist:'Týr',title:'Album / "Deluxe"'});
  for(const value of [null,'bad','[]','[1,2]','["Band",""]'])assert.equal(app.parseAlbumId(value),null);
});
test('album aggregates exactly its tracks and keeps zero-play songs in disc/track order',()=>{
  const calls=[],album=view((...args)=>calls.push(args));
  assert.deepEqual(album.songs.map(s=>s.tid),['TR1','TR2','TR3']);
  assert.deepEqual(album.discs,[1,2]);
  assert.deepEqual(album.metrics.map(m=>m.value),['5','25m','#12']);
  assert.equal(album.songs[1].metric,'0 lượt');
  assert.equal(album.img,'https://example.com/cover.jpg');
  album.songs[0].onTap(); album.goArtist();
  assert.deepEqual(calls,[['song','TR1'],['artist','Band']]);
  assert.equal(app.albumView(app.albumId('Missing','Shared / Title'),rows,stats,{},[],{},'2026-10-03',()=>{}),null);
  const missing=app.albumView(id,rows,{rows:[]},{},[],{},'2026-10-03',()=>{});
  assert.equal(missing.metrics[0].value,'—');
});
test('album renders current All time badges and shares its own Apple Music album',()=>{
  const vm={album:view(),sampleChip:false};
  vm.album.songs[0].metadata=[{text:'+2y',title:'Thêm vào thư viện'},{text:'5:00',title:'Độ dài bài hát'}];
  app.applyArtworkRanks(vm,[{track_id:'TR1',rank:170}],[],{periods:['T08/26','T09/26'],rows:[{track_id:'TR1',history:[{period:'T08/26',rank:218},{period:'T09/26',rank:170}]}]});
  const html=app.renderToStaticMarkup(app.createElement(app.AlbumScreen,{vm,c:{ptoast:()=>{}}}));
  assert.ok(html.includes('Chia sẻ liên kết Apple Music: Shared / Title'));
  assert.ok(html.includes('Hạng All time hiện tại: 170'));
  assert.ok(!html.includes('▲48'));
  assert.ok(html.includes('Đĩa 2'));
  assert.ok(html.includes('Second'));
  assert.ok(html.includes('3x'));
  assert.ok(html.includes('15m'));
  assert.ok(html.indexOf('3x')<html.indexOf('+2y'));
  assert.ok(html.indexOf('15m')<html.indexOf('+2y'));
  assert.equal(new URL(app.appleDetailSearch({kind:'album',artist:'Band',title:'Shared / Title'})).searchParams.get('term'),'Band Shared / Title');
});
test('album song navigation returns to album and never creates a self-parent',()=>{
  const root={screen:'overview'},album={screen:'album',id},song={screen:'song',id:'TR1'};
  let parents=app.rememberParent(root,album,2,{});
  parents=app.rememberParent(album,song,2,parents);
  assert.deepEqual(app.parentPage(song,2,parents),album);
  parents=app.rememberParent(song,album,2,parents);
  assert.deepEqual(app.parentPage(album,2,parents),root);
  const artist={screen:'artist',id:'Band'};
  parents=app.rememberParent(album,artist,2,parents);
  parents=app.rememberParent(artist,album,2,parents);
  assert.deepEqual(app.parentPage(album,2,parents),root);
});
test('album VM waits for complete library pages and resolves real API data',async()=>{
  const calls=[],payload={
    '/artwork':{tracks:{},albums:{},artists:{}},'/ratings':stats,
    '/library/tracks?offset=0&limit=1000':{rows},
    '/charts/songs?window=at&limit=5000':{rows:[]},'/charts/albums?limit=5000':{rows:[]},
    '/history/songs?top=5000&months=36':{periods:[],rows:[]},
  };
  globalThis.fetch=async url=>{const u=new URL(url),path=u.pathname+u.search;calls.push(path);return Response.json(payload[path]);};
  const c={screen:'album',id,p:{...app.BASE},go:()=>{},set:()=>{},later:()=>{},ptoast:()=>{}};
  assert.equal(app.buildVM(c).isLoading,true);
  for(let i=0;i<4;i++){await new Promise(setImmediate);app.buildVM(c);}
  const vm=app.buildVM(c);
  assert.equal(vm.album.title,'Shared / Title');
  assert.equal(vm.album.songs.length,3);
  assert.equal(vm.unavailable,undefined);
  assert.ok(calls.includes('/ratings'));
});

test('release albums without library tracks open a useful album view and retain album share identity',async()=>{
  const release={id:'12345678-1234-1234-1234-123456789012',artist:'Insomnium',title:'Netherworlds',date:'2026-10-16',type:'Album',cover:'https://example.com/netherworlds.jpg',owned:false,url:''};
  app.rememberReleaseAlbum(release);
  assert.deepEqual(app.findReleaseAlbum(release.artist,release.title),release);
  assert.equal(app.findReleaseAlbum('Other',release.title),undefined);
  const c={screen:'album',id:app.albumId(release.artist,release.title),p:{...app.BASE},go:()=>{},set:()=>{},later:()=>{},ptoast:()=>{}};
  let vm=app.buildVM(c);
  for(let i=0;i<4;i++){await new Promise(setImmediate);vm=app.buildVM(c);}
  assert.equal(vm.album.title,release.title);
  assert.equal(vm.album.img,release.cover);
  assert.equal(vm.album.releaseId,release.id);
  assert.deepEqual(vm.album.songs,[]);
  assert.deepEqual(vm.album.metrics,[]);
  const html=app.renderToStaticMarkup(app.createElement(app.AlbumScreen,{vm,c}));
  assert.ok(html.includes('16/10/2026'));
  assert.ok(html.includes('Đang tải danh sách đầy đủ…'));
  assert.ok(html.includes('Chia sẻ liên kết Apple Music: Netherworlds'));
  const requests=[];
  globalThis.fetch=async url=>{requests.push(new URL(url));return Response.json({status:'found',url:'https://music.apple.com/vn/album/netherworlds/123'});};
  await app.loadAppleDetail({kind:'album',artist:release.artist,title:release.title,releaseId:release.id});
  assert.equal(requests[0].searchParams.get('id'),release.id);
  const parents=app.rememberParent({screen:'releases'}, {screen:'album',id:c.id},3,{});
  assert.deepEqual(app.parentPage({screen:'album',id:c.id},3,parents),{screen:'releases'});
});

test('albums named by songs remain openable without local tracks and request their full catalog immediately',async()=>{
  app.invalidate(()=>true);
  const artist='Outside Band',title='Outside Album',id=app.albumId(artist,title),calls=[];
  globalThis.fetch=async url=>{
    const parsed=new URL(url);calls.push(parsed.pathname+parsed.search);
    const body=parsed.pathname==='/library/tracks'?{rows}
      :parsed.pathname==='/ratings'?stats
      :parsed.pathname==='/artwork'?{tracks:{},albums:{},artists:{}}
      :{rows:[]};
    return Response.json(body);
  };
  const c={screen:'album',id,p:{...app.BASE},go:()=>{},set:()=>{},later:()=>{},ptoast:()=>{}};
  let vm;
  for(let i=0;i<5;i++){vm=app.buildVM(c);await new Promise(setImmediate);}
  vm=app.buildVM(c);
  assert.equal(vm.album.title,title);
  assert.equal(vm.album.artist,artist);
  assert.equal(vm.album.catalogOnly,true);
  assert.deepEqual(vm.album.songs,[]);
  const html=app.renderToStaticMarkup(app.createElement(app.AlbumScreen,{vm,c}));
  assert.ok(html.includes('Đang tải danh sách đầy đủ…'));
  assert.ok(!html.includes('Không tìm thấy album'));
  assert.ok(calls.includes('/library/tracks?offset=0&limit=1000'));
});

test('full track list keeps catalog order and merges only unambiguous library matches',()=>{
  const catalog=[{id:'a',artist:'Band',title:'First',disc:1,trackNumber:1},{id:'b',artist:'Band',title:'Missing',disc:1,trackNumber:2},{id:'c',artist:'Band',title:'Same',disc:2,trackNumber:1}];
  const local=[{tid:'TR1',artist:'Band',title:'First 2.1',disc:1,trackNumber:1},{tid:'TR2',artist:'Band',title:'Same',disc:1,trackNumber:3},{tid:'TR3',artist:'Band',title:'Same',disc:2,trackNumber:1}];
  const result=app.mergeAlbumTracks(catalog,local);
  assert.deepEqual(result.map(r=>r.local?.tid),['TR1',undefined,'TR3']);
  assert.equal(app.mergeAlbumTracks(catalog,[{...local[0],gone:true}])[0].local,undefined);
});

test('unreleased title styling uses each track date, keeps released singles and ignores unknown dates',()=>{
  assert.equal(app.unreleasedTrack('2026-10-09','2026-10-03'),true);
  assert.equal(app.unreleasedTrack('2026-09-18','2026-10-03'),false);
  assert.equal(app.unreleasedTrack('2026-10-03','2026-10-03'),false);
  for(const date of [undefined,'2026','2026-10','2026-02-30'])assert.equal(app.unreleasedTrack(date,'2026-01-01'),false);
});

test('period album ranking aggregates all songs beyond ten albums and separates artists and editions',()=>{
  const tracks=Array.from({length:60},(_,i)=>({id:'TR'+i,album:'Album '+i,album_artist:'Band',duration_s:100}));
  tracks.push({id:'TR60',album:'Album 0',album_artist:'Band',duration_s:200},{id:'TR61',album:'Album 0',album_artist:'Other',duration_s:300},{id:'TR62',album:'Album 0 (Deluxe)',album_artist:'Band',duration_s:400});
  const songs=tracks.map((t,i)=>({track_id:t.id,plays:i+1}));
  const result=app.periodAlbumRanking(songs,tracks);
  assert.equal(result.length,62);
  assert.equal(result[0].name,'Album 0 (Deluxe)');
  assert.equal(result[1].artist,'Other');
  const combined=result.find(a=>a.name==='Album 0' && a.artist==='Band');
  assert.equal(combined.plays,62);assert.equal(combined.tracks,2);assert.equal(combined.hours,12300/3600);
  assert.equal(result[61].rank,62);
  assert.deepEqual(app.periodAlbumRanking([{track_id:'TR0',plays:0},{track_id:'missing',plays:99}],tracks),[]);
});

test('album page preserves scope and includes songs excluded from song charts',async()=>{
  for(const scope of ['2026-09','all','ft0424']){
    app.invalidate(()=>true);
    const requests=[];
    globalThis.fetch=async url=>{
      const u=new URL(url);requests.push(u.pathname+u.search);
      const body=u.pathname==='/library/tracks'?{rows:rows.map(r=>({...r,duration_s:900}))}
        :u.pathname==='/ratings'?{rows:rows.map(r=>({track_id:r.id,plays:stats.rows.find(s=>s.track_id===r.id)?.plays || 0}))}
        :u.pathname==='/overview'?{totals:{},months:[],songs:[{track_id:'TR1',plays:u.searchParams.get('scope')==='2024'?4:1}],albums:[]}
        :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows:[]};
      return Response.json(body);
    };
    const calls=[],c={screen:'periodTop',id:`albums~${scope}~2026-09-30`,p:{...app.BASE,periodFilter:'Mới thêm',songView:'Lịch sử'},go:(...args)=>calls.push(args),set:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
    for(let i=0;i<5;i++){app.buildVM(c);await new Promise(setImmediate);}
    const vm=app.buildVM(c);
    assert.equal(vm.unavailable,undefined);assert.equal(vm.periodIsAlbums,true);
    assert.equal(vm.periodAllTime,scope==='all');
    assert.equal(vm.albums[0].plays,`${scope==='all'?5:scope==='ft0424'?6:1} lượt`);
    vm.albums[0].onTap();assert.deepEqual(calls,[['album',id]]);
    assert.ok(!requests.some(x=>x.startsWith('/new-additions')||x.startsWith('/history/period')));
    if(scope==='all')assert.ok(requests.includes('/ratings?asOf=2026-09-30'));
    if(scope==='ft0424')assert.ok([2024,2025,2026].every(year=>requests.includes(`/overview?scope=${year}&asOf=2026-09-30&limit=5000`)));
  }
});


test('album ranking sorts plays independently and uses a consistent top cutoff',()=>{
  const tracks=[row('A','A',1,1,{album:'A',duration_s:600}),row('B','B',1,1,{album:'B',duration_s:60})];
  const plays=[{track_id:'A',plays:2},{track_id:'B',plays:10}];
  assert.equal(app.rankedAlbums(plays,tracks,'Giờ nghe')[0].name,'A');
  assert.equal(app.rankedAlbums(plays,tracks,'Lượt')[0].name,'B');
  assert.equal(app.rankChange(30,20,25),'new');
  assert.equal(app.rankChange(24,20,25),4);
  assert.equal(app.rankChange(undefined,20,25),'new');
  assert.deepEqual(app.albumHistoryDates('2026-09','2026-10-03'),['2026-09-07','2026-09-14','2026-09-21','2026-09-28']);
  assert.ok(app.albumHistoryDates('2025','2026-10-03').every(x=>x.startsWith('2025')));
  assert.equal(app.albumHistoryDates('all','2026-10-03').at(-1),'2026-09-30');
});

test('album filters keep actual ranks; history is fetched lazily and renders month checkpoints',async()=>{
  app.invalidate(()=>true);
  const tracks=[row('A','A',1,1,{album:'A',duration_s:18000}),row('B','B',1,1,{album:'B',duration_s:2700}),row('C','C',1,1,{album:'C',duration_s:2700})];
  const paths=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);paths.push(u.pathname+u.search);
    const current=u.searchParams.get('asOf')==='2026-10-03';
    const body=u.pathname==='/library/tracks'?{rows:tracks}:u.pathname==='/ratings'?{rows:current?[{track_id:'A',plays:20},{track_id:'B',plays:100},{track_id:'C',plays:1}]:[{track_id:'A',plays:2},{track_id:'B',plays:90},{track_id:'C',plays:0}]}
      :u.pathname==='/charts/albums'?{rows:current?[{album_artist:'Band',album:'A',rank:12},{album_artist:'Band',album:'B',rank:7}]:[{album_artist:'Band',album:'A',rank:11},{album_artist:'Band',album:'B',rank:9}]}
      :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows:[]};
    return Response.json(body);
  };
  const p={...app.BASE},c={screen:'periodTop',id:'albums~all~2026-10-03',p,go:()=>{},set:fn=>Object.assign(p,fn(p)),goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const settle=async()=>{for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}return app.buildVM(c);};
  let vm=await settle();assert.equal(vm.albums[0].title,'A');
  assert.ok(!paths.some(x=>x.includes('asOf=2026-09-30')));
  vm.albumSortChips.find(x=>x.label==='Tăng hạng').onTap();vm=await settle();assert.deepEqual(vm.albums.map(r=>[r.title,r.rank]),[['B',2]]);
  p.albumFilter='Mới vào';vm=await settle();assert.deepEqual(vm.albums.map(r=>r.title),['C']);
  p.albumFilter='Tất cả';p.albumSort='Lượt';vm=await settle();assert.equal(vm.albums[0].title,'B');
  p.albumSort='Lịch sử';vm=await settle();assert.equal(vm.albumIsHistory,true);
  assert.ok(paths.includes('/ratings?asOf=2025-10-31'));
  const html=app.renderToStaticMarkup(vm.rankHistoryChart);assert.ok(html.includes('Hiện tại'));assert.ok(html.includes('A · Band'));
});

test('approved In Flames editions share an album without merging tracks or other artists',()=>{
  const edition='The Jester Race (Black Ash-Inheritance Version)';
  const tracks=[row('A','First',1,1,{artist:'In Flames',album_artist:'In Flames',album:'The Jester Race',duration_s:300}),row('B','Bonus',1,2,{artist:'In Flames',album_artist:'In Flames',album:edition,duration_s:600}),row('C','Other artist',1,1,{artist:'Other',album_artist:'Other',album:edition})];
  const stats={rows:[{track_id:'A',plays:10},{track_id:'B',plays:20},{track_id:'C',plays:100}]};
  const canonical=app.albumId('In Flames','The Jester Race');
  assert.equal(app.albumId('In Flames',edition),canonical);
  assert.equal(app.canonicalAlbum('Other',edition),edition);
  const album=app.albumView(JSON.stringify(['In Flames',edition]),tracks,stats,{},[],{},'2026-10-03',()=>{});
  assert.equal(album.title,'The Jester Race');
  assert.deepEqual(album.songs.map(r=>r.tid),['A','B']);
  assert.deepEqual(album.metrics.slice(0,2).map(r=>r.value),['30','4h 10m']);
  assert.equal(album.songs[1].originalAlbum,edition);
  assert.equal(tracks[1].album,edition);
  const ranking=app.periodAlbumRanking(stats.rows,tracks);
  const merged=ranking.find(r=>r.artist==='In Flames');
  assert.equal(merged.plays,30);assert.equal(merged.seconds,15000);assert.equal(merged.tracks,2);
  assert.equal(ranking.length,2);
});
test('merged All time album ranks recalculate level, totals, ties and exclusions',()=>{
  const edition='The Jester Race (Black Ash-Inheritance Version)';
  const tracks=[row('A','First',1,1,{album_artist:'In Flames',album:'The Jester Race',duration_s:1800}),row('B','Bonus',1,2,{album_artist:'In Flames',album:edition,duration_s:1800}),row('C','Other',1,1,{album:'Other',duration_s:3600}),row('X','Excluded',1,1,{album:'Archive',duration_s:3600})];
  const stats=[{track_id:'A',plays:12},{track_id:'B',plays:12},{track_id:'C',plays:12},{track_id:'X',plays:1000}];
  const ranks=app.groupedAllTimeAlbumRanks(tracks,stats);
  assert.equal(ranks.length,2);assert.deepEqual(ranks.map(r=>r.rank),[1,1]);
  const merged=ranks.find(r=>r.album_artist==='In Flames');
  assert.equal(merged.hours,12);assert.equal(merged.level,2);assert.equal(merged.tracks,2);
  assert.equal(app.groupedAllTimeAlbumRanks(tracks,stats.slice(0,2)),null);
});

test('All time album list prioritizes level over hours and agrees with cover ranks without a merged edition',()=>{
  const tracks=[
    row('A','Long album',1,1,{album:'Long album',duration_s:2700}),
    row('B','EP',1,1,{album:'EP',duration_s:1800}),
    row('C','Tie',1,1,{album:'Tie',duration_s:2700}),
    row('D','Short',1,1,{album:'Short',duration_s:900}),
    row('E','Leader',1,1,{album:'Leader',duration_s:1200}),
    row('Z','Never played',1,1,{album:'Never played',duration_s:3600}),
  ];
  const plays=[['A',8],['B',40],['C',8],['D',1],['E',72],['Z',0]].map(([track_id,plays])=>({track_id,plays}));
  const ranked=app.rankedAlbums(plays,tracks,'Giờ nghe',true);
  assert.deepEqual(ranked.map(r=>r.name),['Leader','Long album','Tie','EP']);
  assert.deepEqual(ranked.map(r=>r.level),[3,2,2,1]);
  assert.deepEqual(ranked.map(r=>r.rank),[1,2,2,4]);
  assert.deepEqual(ranked.map(r=>[r.key,r.rank]),app.allTimeAlbumRanks(tracks,plays).map(r=>[r.album_artist+'\u001f'+r.album,r.rank]));
  assert.equal(ranked.find(r=>r.name==='Long album').plays,8);
  assert.equal(app.rankedAlbums(plays,tracks,'Giờ nghe')[1].name,'EP');
  assert.equal(app.rankedAlbums(plays,tracks,'Lượt',true)[1].name,'EP');
});
test('All time list uses full album duration including unplayed tracks when assigning level',()=>{
  const tracks=[row('A','Played',1,1,{album:'X',duration_s:1800}),row('B','Unplayed',1,2,{album:'X',duration_s:900})];
  const ranks=app.rankedAlbums([{track_id:'A',plays:12},{track_id:'B',plays:0}],tracks,'Giờ nghe',true);
  assert.equal(ranks[0].level,2);assert.equal(ranks[0].tracks,1);assert.equal(ranks[0].hours,6);
});

test('All time overview and full album list use the same level order, even without grouped editions',async()=>{
  app.invalidate(()=>true);
  const tracks=[row('A','Long album',1,1,{album:'Long album',duration_s:2700}),row('B','EP',1,1,{album:'EP',duration_s:1800})];
  const plays=[{track_id:'A',plays:8},{track_id:'B',plays:40}];
  globalThis.fetch=async url=>{
    const u=new URL(url);
    const body=u.pathname==='/library/tracks'?{rows:tracks}:u.pathname==='/ratings'?{rows:plays}
      :u.pathname==='/summary'?{asOf:'2026-10-06',week:{plays:0},month:{plays:0},year:{plays:0},total:{plays:48}}
      :u.pathname==='/overview'?{totals:{albums:2},months:[],songs:[],artists:[],genres:[],albums:[{name:'EP',artist:'Band',plays:40,hours:20},{name:'Long album',artist:'Band',plays:8,hours:6}]}
      :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows:[]};
    return Response.json(body);
  };
  const c={screen:'overview',id:null,p:{...app.BASE,scope:'All time'},go:()=>{},set:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const settle=async()=>{for(let i=0;i<5;i++){app.buildVM(c);await new Promise(setImmediate);}return app.buildVM(c);};
  const preview=await settle();
  assert.equal(preview.unavailable,undefined);
  assert.deepEqual(preview.albums.map(a=>a.title),['Long album','EP']);
  c.screen='periodTop';c.id='albums~all~2026-10-06';
  const full=await settle();
  assert.deepEqual(full.albums.map(a=>[a.title,a.rank]),preview.albums.map(a=>[a.title,a.rank]));
});
