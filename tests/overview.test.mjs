import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const built = await build({
  stdin: { contents: `export { songRankTimeline, songRankColor, ranksWithHistoricalGaps } from './src/lib/song-rank-history'; export { songHistoryChart } from './src/lib/charts'; export { parentPage, rememberParent } from './src/lib/navigation'; export { newAdditions } from '../../server/src/newAdditions'; export { monthWeeks, stackMonthWeeks, MonthWeeksChart } from './src/lib/month-weeks'; export { vnHour, vnWeekdayIndex } from './src/lib/fmt'; export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { MonthlySummaryReadout } from './src/components/month-summary-popup'; export { RecentScreen, ArtistsAllScreen, PeriodTopScreen, Top100Screen, TrendScreen, OverviewScreen } from './src/screens/main'; export { periodRankHistory, rankCheckpoints } from '../../server/src/periodHistory'; export { periodSongRank } from '../../server/src/periodRank'; export { dailyThisWeek, hourlyToday } from '../../server/src/today'; export { overview, overviewRange } from '../../server/src/overview'; export { buildVM } from './src/vm'; export { BASE, TABS, pathOf } from './src/state'; export { invalidate } from './src/lib/api'; export * from './src/lib/list-preferences';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle:true, write:false, format:'esm', platform:'browser',
  define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
});
globalThis.window = {location:{pathname:'/',search:''},localStorage:{getItem:()=>null,setItem:()=>{}}};
const app = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tracks (id TEXT, title TEXT, artist TEXT, album_artist TEXT, duration_s INTEGER, album_id TEXT, album TEXT, genre TEXT);
    CREATE TABLE plays (track_id TEXT, play_date TEXT, hour INTEGER);
    INSERT INTO tracks VALUES ('TRA','A','Artist A',NULL,3600,'A','Album A','Rock'), ('TRB','B','Artist B',NULL,1800,'B','Album B','Pop');
    INSERT INTO plays VALUES ('TRA','2026-09-27',9), ('TRA','2026-09-28',10), ('TRA','2026-09-30',11),
      ('TRB','2026-10-01',12), ('TRA','2026-10-02',13), ('TRB','2026-10-03',14), (NULL,'2026-10-02',15);
    ALTER TABLE tracks ADD COLUMN rank_weight REAL NOT NULL DEFAULT 1;
    ALTER TABLE tracks ADD COLUMN rank_weight_custom REAL;`);
  const calls = [];
  const env = { LASTFM_FROM:'2025-01-01', DB:{
    prepare(sql) { return {bind(...args) {return {sql,args, async all() { return { results: db.prepare(sql).all(...args) }; }};}}; },
    async batch(statements) { return statements.map(({sql,args})=>{
      calls.push({sql,args});
      const params=[];
      const positional=sql.replace(/\?(\d+)/g,(_,number)=>{params.push(args[Number(number)-1]);return '?';});
      return {results:db.prepare(positional).all(...params)};
    }); },
  }};
  return {env,db,calls};
}

test('monthly overview defaults use the current Vietnam weekday and hour', () => {
  const now = Date.parse('2026-10-05T18:30:00Z'); // 01:30 Tuesday in Vietnam.
  assert.equal(app.vnWeekdayIndex(now), 1);
  assert.equal(app.vnHour(now), 1);
});

test('compact monthly-hours readout exposes its month as the summary trigger', () => {
  const c={p:{...app.BASE},screen:'overview',id:null,set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const html=app.renderToStaticMarkup(app.createElement(app.MonthlySummaryReadout,{
    value:'T03/25·2d 12h 36m·#1 Aephanemer',c,
    months:[{label:'T03/25',period:'2025-03',index:0}],onMonthSelect:()=>{},
  }));
  assert.match(html,/aria-label="Mở tổng kết T03\/25; nhấn giữ để chọn tháng"/);
  assert.match(html,/>T03\/25<\/button>/);
  assert.match(html,/>2d 12h 36m</);
  assert.match(html,/>#1 Aephanemer</);
});

test('current week starts Monday across month and year boundaries, including Sunday', () => {
  assert.deepEqual(app.overviewRange('week','2026-10-02'),{from:'2026-09-28',to:'2026-10-02'});
  assert.deepEqual(app.overviewRange('week','2026-10-04'),{from:'2026-09-28',to:'2026-10-04'});
  assert.deepEqual(app.overviewRange('week','2026-10-05'),{from:'2026-10-05',to:'2026-10-05'});
  assert.deepEqual(app.overviewRange('week','2027-01-01'),{from:'2026-12-28',to:'2027-01-01'});
  assert.deepEqual(app.overviewRange('2024-02','2024-02-29'),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(app.overviewRange('15d','2026-10-18'),{from:'2026-10-04',to:'2026-10-18'});
  assert.deepEqual(app.overviewRange('1m','2026-10-18'),{from:'2026-09-19',to:'2026-10-18'});
});

test('weekly overview SQL filters totals, lists, and day/hour series to Monday–today', async () => {
  const {env,db}=fixture();
  try {
    const result=await app.overview(env,'week','2026-10-02');
    assert.equal(result.from,'2026-09-28'); assert.equal(result.to,'2026-10-02');
    assert.equal(result.totals.plays,4); assert.equal(result.totals.songs,2);
    assert.equal(result.totals.hours,3.5);
    assert.deepEqual(result.months.map(m=>[m.month,m.plays]),[['2026-09',2],['2026-10',2]]);
    assert.equal(result.songs[0].plays,3); assert.equal(result.artists[0].hours,3);
    assert.equal(result.albums[0].plays,3); assert.equal(result.genres[0].plays,3);
    assert.deepEqual(result.byDay.map(d=>d.k),['2026-09-28','2026-09-30','2026-10-01','2026-10-02']);
    assert.deepEqual(result.byHour.map(d=>d.k),[10,11,12,13]);
    assert.equal(result.beforeTracking,undefined);
    const empty=await app.overview(env,'week','2026-10-05');
    assert.equal(empty.totals.songs,0); assert.equal(empty.songs.length,0); assert.equal(empty.byDay.length,0);
  } finally {db.close();}
});

test('Statistics has no week filter; month scope still renders actual server values',async()=>{
  assert.deepEqual(app.TABS,['today','trend','overview','releases','library']);
  const {env,db}=fixture();
  const monthly=await app.overview(env,'2026-09','2026-10-02'); db.close();
  const calls=[], p={...app.BASE,scope:'Tháng trước'};
  const period={plays:3,tracks:1,artists:1};
  const payload={
    '/summary':{asOf:'2026-10-02',week:period,month:period,year:period,total:{plays:3}},
    '/artwork':{artists:{},tracks:{},albums:{}}, '/release-years':{rows:[]}, '/overview?scope=2026-09':monthly,
  };
  globalThis.fetch=async url=>{
    const u=new URL(url),path=u.pathname+u.search;calls.push(path);
    return new Response(JSON.stringify(payload[path]),{status:200});
  };
  const ctx={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx);
  assert.ok(calls.includes('/overview?scope=2026-09'));
  assert.ok(!calls.includes('/overview?scope=week'));
  assert.equal(vm.isMonth,true);assert.equal(vm.isAll,false);
  assert.equal(vm.stats[0].v,'3');assert.equal(vm.top15[0].title,'A');
  assert.equal(vm.rd.day,'30/09 · 1 lượt');
  assert.equal(vm.monthWeeks.length,5);
  assert.deepEqual(vm.monthWeeks[4].values,[1,0,1,null,null,null,null]);
  assert.ok(!vm.scopeChips.some(c=>c.label==='Tuần hiện tại'));
  assert.equal(vm.unavailable,undefined);
});


test('today clock counts only today and excludes unlinked plays', async () => {
  const {env, db} = fixture();
  try {
    const hours = await app.hourlyToday(env, '2026-10-02');
    assert.deepEqual(hours.map(r => [r.k, r.plays]), [[13, 1]]);
    assert.deepEqual(await app.hourlyToday(env, '2026-10-04'), []);
  } finally { db.close(); }
});

test('period drill-down returns beyond the preview limit with the same leading order', async () => {
  const {env, db} = fixture();
  try {
    for (let i=0;i<35;i++) {
      db.prepare('INSERT INTO tracks(id,title,artist,album_artist,duration_s,album_id,album,genre) VALUES (?,?,?,?,?,?,?,?)').run('TR'+i, 'Song'+i, 'Artist'+i, null, 100+i, 'AL'+i, 'Album'+i, 'Rock');
      db.prepare('INSERT INTO plays VALUES (?,?,?)').run('TR'+i, '2026-09-29', 10);
    }
    const preview=await app.overview(env,'week','2026-10-02');
    const full=await app.overview(env,'week','2026-10-02',5000);
    assert.equal(preview.artists.length,25); assert.equal(full.artists.length,37);
    assert.equal(full.songs.length,37);
    for (const kind of ['artists','songs']) {
      const h=await app.periodRankHistory(env,'week','2026-10-02',kind,'hours');
      assert.equal(h.rows.length,37);
      const expected=kind==='artists'?full.artists.map(r=>r.name):full.songs.map(r=>r.track_id);
      assert.deepEqual(h.rows.map(r=>r.id),expected);
    }
    assert.deepEqual(full.artists.slice(0,5),preview.artists.slice(0,5));
    assert.deepEqual(full.songs.slice(0,5),preview.songs.slice(0,5));
    const october=await app.overview(env,'2026-10','2026-10-02',5000);
    assert.equal(october.songs.length,2);
  } finally { db.close(); }
});

test('overview links preserve scope and date; all-time links use existing full pages', async () => {
  app.invalidate(()=>true);
  const calls=[];
  const sample={totals:{plays:3}, months:[{month:'2026-09',plays:3,hours:1}], byDay:[], byWeekday:[], byHour:[], artists:[{name:'Scoped artist',hours:1,plays:3,tracks:1}], songs:[{track_id:'TRA',title:'Scoped song',plays:3}]};
  globalThis.fetch=async url=>{
    const u=new URL(url),path=u.pathname+u.search;
    let body=path==='/summary' ? {asOf:'2026-10-02',week:{plays:3},month:{plays:0},year:{plays:3},total:{plays:3}}
      : path==='/artwork' ? {artists:{},tracks:{},albums:{}}
      : path.startsWith('/overview') ? sample
      : path.startsWith('/history/songs') ? {periods:['2026-09'],rows:[{rank:1,track_id:'TRH',title:'Historical top',plays:100}]}
      : path.startsWith('/artists/alltime') ? {rows:[{rank:1,artist:'All-time artist',hours:900,plays:1000}]}
      : {rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const p={...app.BASE,scope:'Tháng trước'};
  const ctx={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>calls.push(args),goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const settle=async c=>{for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}return app.buildVM(c);};
  let vm=await settle(ctx);
  assert.deepEqual(vm.scopeChips.map(x=>x.label),['Tháng 9','Tháng 10','Năm 2026','All time']);
  assert.equal(vm.isMonth,true); assert.equal(vm.topArtistsTitle,'Top 6 Artists M09/26');
  assert.equal(vm.topAlbumsTitle,'Top 6 Albums M09/26');
  assert.equal(vm.topSongsTitle,'Top 10 Songs M09/26');
  assert.equal(vm.topGenresTitle,'Top 10 Genres M09/26');
  vm.viewArtists();vm.viewSongs();
  assert.deepEqual(calls,[['periodTop','artists~2026-09~2026-10-02'],['periodTop','songs~2026-09~2026-10-02']]);
  const full=await settle({...ctx,screen:'periodTop',id:calls[1][1]});
  assert.equal(full.periodRows[0].title,vm.top15[0].title);
  p.scope='All time'; vm=await settle(ctx);
  assert.equal(vm.hourArtists[0].name,'All-time artist');
  assert.equal(vm.top15[0].title,'Historical top');
  vm.viewArtists();vm.viewSongs();
  assert.deepEqual(calls.slice(-2),[['artistsAll'],['top100']]);
});

test('monthly overview renders a compact summary with drill-down links', async () => {
  app.invalidate(()=>true);
  const requests=[], navigation=[];
  const monthly={
    totals:{plays:257,songs:130,artists:45,albums:74,genres:22},
    months:[{month:'2026-10',plays:257,hours:50}],
    byDay:[{k:'2026-10-01',plays:20},{k:'2026-10-02',plays:30}],
    byWeekday:[], byHour:[],
    artists:[
      {name:'In Flames',hours:12,plays:90,tracks:8},
      {name:'New Artist',hours:4,plays:12,tracks:2},
      {name:'Aephanemer',hours:3,plays:10,tracks:2},
    ],
    songs:[
      {track_id:'S1',title:'Rising Song',artist:'In Flames',plays:9,hours:1},
      {track_id:'S2',title:'New Song',artist:'New Artist',plays:5,hours:.5},
    ],
    albums:[], genres:[],
  };
  globalThis.fetch=async url=>{
    const u=new URL(url), path=u.pathname+u.search; requests.push(path);
    let body;
    if(u.pathname==='/summary') body={asOf:'2026-10-02',week:{},month:{},year:{},total:{}};
    else if(u.pathname==='/artwork') body={artists:{'In Flames':'https://img.test/in-flames.jpg','New Artist':'https://img.test/new.jpg'},tracks:{S1:'https://img.test/s1.jpg',S2:'https://img.test/s2.jpg'},albums:{}};
    else if(u.pathname==='/overview') body=monthly;
    else if(u.pathname==='/new-additions') body={artists:[{name:'New Artist',added:'2026-10-02'}],songs:[{track_id:'S2',title:'New Song',artist:'New Artist',plays:5,added:'2026-10-01'}]};
    else if(u.pathname==='/charts/artists' && u.searchParams.get('asOf')==='2026-09-30') body={rows:[{rank:34,artist:'In Flames'},{rank:31,artist:'Aephanemer'}]};
    else if(u.pathname==='/charts/artists') body={rows:[{rank:29,artist:'In Flames'},{rank:31,artist:'Aephanemer'},{rank:88,artist:'New Artist'}]};
    else if(u.pathname==='/charts/songs' && u.searchParams.get('asOf')==='2026-09-30') body={rows:[{rank:80,track_id:'S1',title:'Rising Song'}]};
    else if(u.pathname==='/charts/songs') body={rows:[{rank:70,track_id:'S1',title:'Rising Song'},{rank:120,track_id:'S2',title:'New Song'}]};
    else body={rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const p={...app.BASE,scope:'Tháng'};
  const ctx={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>navigation.push(args),goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx);
  assert.equal(vm.monthSummary.title,'Tóm tắt tháng 10');
  assert.equal(vm.monthSummary.status,'257 lượt · 130 bài · 45 nghệ sĩ · 74 album');
  assert.equal(vm.monthSummary.lead.name,'In Flames');
  assert.equal(vm.monthSummary.lead.img,'https://img.test/in-flames.jpg');
  assert.deepEqual(vm.monthSummary.newArtists.map(r=>[r.name,r.img]),[['New Artist','https://img.test/new.jpg']]);
  assert.deepEqual(vm.monthSummary.risingArtists.map(r=>[r.name,r.change]),[['In Flames',5]]);
  assert.deepEqual(vm.monthSummary.newSongs.map(r=>[r.name,r.img]),[['New Song','https://img.test/s2.jpg']]);
  assert.deepEqual(vm.monthSummary.risingSongs.map(r=>[r.name,r.change,r.img]),[['Rising Song',10,'https://img.test/s1.jpg']]);
  const html=app.renderToStaticMarkup(app.createElement(app.OverviewScreen,{vm,c:ctx}));
  assert.ok(html.includes('Tóm tắt tháng 10'));
  assert.ok(html.includes('Nghệ sĩ mới'));
  assert.ok(html.includes('Tăng hạng'));
  assert.ok(html.includes('Bài hát mới nổi bật'));
  assert.ok(html.includes('Bài hát tăng hạng'));
  assert.ok(!html.includes('bài đã nghe'));
  vm.monthSummary.openAll(); vm.monthSummary.openNew(); vm.monthSummary.openRising(); vm.monthSummary.openNewSongs(); vm.monthSummary.openRisingSongs();
  assert.deepEqual(navigation,[
    ['periodTop','artists~2026-10~2026-10-02',{periodFilter:'Tất cả',periodSort:'Giờ nghe'}],
    ['periodTop','artists~2026-10~2026-10-02',{periodFilter:'Mới thêm',periodSort:'Giờ nghe'}],
    ['periodTop','artists~2026-10~2026-10-02',{periodFilter:'Đang lên',periodSort:'Giờ nghe'}],
    ['periodTop','songs~2026-10~2026-10-02',{periodFilter:'Mới thêm',songView:'Danh sách'}],
    ['periodTop','songs~2026-10~2026-10-02',{periodFilter:'Đang lên',songView:'Danh sách'}],
  ]);
});

test('optional all-time summary endpoints do not show the offline cache banner', async () => {
  app.invalidate(()=>true);
  const allTime={
    totals:{plays:22797,songs:1906,artists:309,albums:894,genres:65},
    months:[{month:'2026-10',plays:43,hours:9}],
    byDay:[], byWeekday:[], byHour:[],
    artists:[{name:'MONO',hours:273,plays:1000,tracks:20}],
    songs:[{track_id:'TR1',title:'One With The Shadow',artist:'MONO',plays:200,hours:20}],
    albums:[], genres:[],
  };
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname==='/new-additions' || (u.pathname==='/charts/artists' && u.searchParams.has('asOf')) || (u.pathname==='/charts/songs' && u.searchParams.has('asOf')))
      return new Response(JSON.stringify({error:'offline'}),{status:503});
    let body;
    if(u.pathname==='/summary') body={asOf:'2026-10-05',week:{plays:0},month:{plays:43},year:{plays:1547},total:{plays:22797}};
    else if(u.pathname==='/artwork') body={artists:{},tracks:{},albums:{}};
    else if(u.pathname==='/overview') body=allTime;
    else if(u.pathname==='/history/songs') body={periods:['2026-10'],rows:[{rank:1,track_id:'TR1',title:'One With The Shadow',plays:200}]};
    else if(u.pathname==='/artists/alltime') body={rows:[{rank:1,artist:'MONO',hours:273,plays:1000}]};
    else body={rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const p={...app.BASE,scope:'All time'};
  const ctx={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx);
  assert.equal(vm.unavailable,undefined);
  assert.equal(vm.sampleChip,false);
  assert.equal(vm.monthSummary.title,'Tóm tắt All time');
  assert.equal(vm.monthSummary.risingArtists.length,0);
});

test('all-time summary highlights notable recent library additions and rising top-100 songs', async () => {
  app.invalidate(()=>true);
  const navigation=[];
  const allTime={
    totals:{plays:22797,songs:1906,artists:309,albums:894,genres:65},
    months:[{month:'2026-10',plays:43,hours:9}],
    byDay:[], byWeekday:[], byHour:[],
    artists:[{name:'MONO',hours:273,plays:1000,tracks:20}],
    songs:[{track_id:'TR1',title:'One With The Shadow',artist:'MONO',plays:200,hours:20}],
    albums:[], genres:[],
  };
  globalThis.fetch=async url=>{
    const u=new URL(url);
    let body;
    if(u.pathname==='/summary') body={asOf:'2026-10-05',week:{plays:0},month:{plays:43},year:{plays:1547},total:{plays:22797}};
    else if(u.pathname==='/artwork') body={artists:{'New Loud Artist':'artist.jpg'},tracks:{NEW:'new.jpg',RISE:'rise.jpg'},albums:{}};
    else if(u.pathname==='/overview') body=allTime;
    else if(u.pathname==='/new-additions') {
      assert.equal(u.searchParams.get('scope'),'2026');
      body={artists:[
        {name:'Silent New Artist',plays:0,hours:0,tracks:4,added:'2026-01-01'},
        {name:'New Loud Artist',plays:12,hours:3,tracks:2,added:'2026-09-01'},
      ],songs:[
        {track_id:'QUIET',title:'Quiet New Song',artist:'Silent New Artist',plays:0,hours:0,added:'2026-01-01'},
        {track_id:'NEW',title:'New Loud Song',artist:'New Loud Artist',plays:7,hours:1,added:'2026-09-02'},
      ]};
    }
    else if(u.pathname==='/history/songs') body={asOf:'2026-10-05',periods:['T09/26'],rows:[
      {track_id:'STEADY',title:'Steady Top Song',artist:'Band',rank:10,rise:0},
      {track_id:'RISE',title:'Rising Top Song',artist:'Band',rank:77,rise:4},
      {track_id:'OUT',title:'Outside Top 100',artist:'Band',rank:101,rise:20},
    ]};
    else if(u.pathname==='/artists/alltime') body={rows:[{rank:1,artist:'MONO',hours:273,plays:1000}]};
    else if(u.pathname==='/charts/artists' && u.searchParams.has('asOf')) body={rows:[{rank:1,artist:'MONO'}]};
    else if(u.pathname==='/charts/songs' && u.searchParams.has('asOf')) body={rows:[]};
    else body={rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const p={...app.BASE,scope:'All time'};
  const ctx={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>navigation.push(args),goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx);
  assert.deepEqual(vm.monthSummary.newArtists.map(r=>[r.name,r.img]),[['New Loud Artist','artist.jpg']]);
  assert.deepEqual(vm.monthSummary.newSongs.map(r=>[r.name,r.img]),[['New Loud Song','new.jpg']]);
  assert.deepEqual(vm.monthSummary.risingSongs.map(r=>[r.name,r.change,r.img]),[['Rising Top Song',4,'rise.jpg']]);
  vm.monthSummary.openNew(); vm.monthSummary.openNewSongs();
  assert.deepEqual(navigation,[
    ['periodTop','artists~2026~2026-10-05',{periodFilter:'Mới thêm',periodSort:'Giờ nghe'}],
    ['periodTop','songs~2026~2026-10-05',{periodFilter:'Mới thêm',songView:'Danh sách'}],
  ]);
});

test('Today shows rolling 15-day songs before recent, caps each artist at three, and adds artist rank movement', async () => {
  app.invalidate(()=>true);
  const date='2026-10-18', paths=[], navigation=[];
  const rolling=[
    ...Array.from({length:4},(_,i)=>({rank:i+1,track_id:'A'+i,title:'Artist A '+i,artist:'Artist A',plays:20-i})),
    {rank:5,track_id:'B1',title:'Artist B 1',artist:'Artist B',plays:15},
    {rank:6,track_id:'C1',title:'Artist C 1',artist:'Artist C',plays:14},
  ];
  const period={plays:70,tracks:6,artists:3};
  globalThis.fetch=async url=>{
    const u=new URL(url),path=u.pathname+u.search; paths.push(path);
    let body;
    if(u.pathname==='/summary') body={asOf:date,week:period,month:period,year:period,total:{plays:70,songs:6,artists:3}};
    else if(u.pathname==='/artwork') body={artists:{},tracks:{},albums:{}};
    else if(u.pathname==='/overview' && u.searchParams.get('scope')==='week') body={totals:period,months:[],byHour:[]};
    else if(u.pathname==='/overview' && u.searchParams.get('scope')==='15d') body={totals:period,months:[],artists:[],songs:rolling,albums:[],genres:[]};
    else if(u.pathname==='/daily') body={byHour:[],days:[{date,plays:0,lastWeek:0,record:0}]};
    else if(u.pathname==='/recent') body={rows:[]};
    else if(u.pathname==='/artists/week') body={rows:[{artist:'Artist A',plays:22,byDay:[1,2,3,4,5,6,1]}]};
    else if(u.pathname==='/charts/songs' && u.searchParams.get('window')==='15d') body={rows:rolling};
    else if(u.pathname==='/charts/artists' && u.searchParams.has('asOf')) body={rows:[{artist:'Artist A',rank:29}]};
    else if(u.pathname==='/charts/artists') body={rows:[{artist:'Artist A',rank:22}]};
    else body={rows:[]};
    return Response.json(body);
  };
  const p={...app.BASE,scope:'All time'};
  const ctx={p,screen:'today',id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>navigation.push(args),goTab:()=>assert.fail('must not open overview'),later:()=>{},ptoast:()=>{}};
  for(let i=0;i<5;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const today=app.buildVM(ctx);
  assert.equal(today.top5Title,'Top songs · 15 ngày');
  assert.deepEqual(today.top5.map(row=>row.artist),['Artist A','Artist A','Artist A','Artist B','Artist C']);
  assert.deepEqual([today.weekTable[0].rank,today.weekTable[0].rankChange],[22,7]);
  today.viewTodaySongs();
  assert.deepEqual(navigation,[['periodTop','songs~15d~2026-10-18',{periodFilter:'Tất cả',songView:'Danh sách'}]]);
  const fullCtx={...ctx,screen:'periodTop',id:navigation[0][1]};
  for(let i=0;i<3;i++){app.buildVM(fullCtx);await new Promise(setImmediate);}
  const full=app.buildVM(fullCtx);
  assert.ok(paths.some(path=>path.startsWith('/overview?scope=15d&asOf=2026-10-18')));
  assert.equal(full.periodListOnly,true);
  assert.deepEqual(full.songViewTabs.map(tab=>tab.label),['Danh sách']);
});

test('artist play sorting displays play positions instead of unrelated hours ranks', async () => {
  app.invalidate(()=>true);
  const p={...app.BASE,sort:'Lượt'};
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    const body=path==='/artwork'?{artists:{},tracks:{},albums:{}}:path==='/artists/alltime'?{rows:[
      {rank:9,artist:'More plays',plays:200,hours:1},
      {rank:1,artist:'More hours',plays:100,hours:200},
    ]}:{rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const ctx={p,screen:'artistsAll',id:null,set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  app.buildVM(ctx);await new Promise(setImmediate);
  const vm=app.buildVM(ctx);
  assert.deepEqual(vm.artistRows.map(r=>[r.name,r.rank]),[['More plays',1],['More hours',2]]);
});

test('period top rows keep period metrics and enrich history/artwork, with period filters and artist sorting', async () => {
  app.invalidate(()=>true);
  const song={track_id:'TRPeriod',title:'Period song',artist:'Period artist',plays:9};
  const p={...app.BASE};
  const paths=[];
  globalThis.fetch=async url=>{
    const u=new URL(url); paths.push(u.pathname+u.search);
    let body;
    if(u.pathname==='/artwork') body={artists:{'Period artist':'https://example.test/artist.jpg'},tracks:{},albums:{}};
    else if(u.pathname==='/artists/alltime') body={rows:[{artist:'Period artist',hours:900,plays:9000,points:42,flag:'*',lastPlayed:'2026-10-01'}]};
    else if(u.pathname==='/history/songs') body={periods:['2026-08','2026-09'],rows:[{...song,rank:15,plays:500,best:{rank:12,period:'2026-08'},monthsInTop100:7,history:[{period:'2026-08',rank:12},{period:'2026-09',rank:15}]}]};
    else if(u.pathname==='/overview') body={totals:{plays:9},months:[],artists:[{name:'Period artist',hours:2,plays:9,tracks:3}],songs:u.searchParams.get('scope')==='2026-08'?[{...song,rank:3}]:[song]};
    else body={rows:[]};
    return new Response(JSON.stringify(body),{status:200});
  };
  const ctx={p,screen:'periodTop',id:'songs~2026-09~2026-10-02',set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const settle=async()=>{for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}return app.buildVM(ctx);};
  let vm=await settle();
  assert.equal(vm.periodRows[0].rank,1); assert.equal(vm.periodRows[0].metric,'9 lượt');
  assert.equal(vm.periodRows[0].change,2);
  assert.match(vm.periodRows[0].peak,/#12.*All time/);
  assert.equal(vm.periodRows[0].months,'7 tháng trong top 100');
  assert.ok(vm.periodRows[0].spark);
  (ctx.id.startsWith('artists')?vm.periodSortChips:vm.songViewTabs).find(x=>x.label==='Tăng hạng').onTap();
  vm=app.buildVM(ctx);
  assert.equal((ctx.id.startsWith('artists')?vm.periodSortChips:vm.songViewTabs).find(x=>x.label==='Tăng hạng').active,true);
  assert.deepEqual(vm.periodRows.map(r=>[r.tid,r.rank,r.change]),[]); // Period rise alone does not qualify.
  vm.periodFilterChips.find(x=>x.label==='Mới vào').onTap();
  assert.equal(app.buildVM(ctx).periodRows.length,0);
  ctx.id='artists~2026-09~2026-10-02'; p.periodFilter='Tất cả'; vm=await settle();
  assert.equal(vm.periodIsArtists,true);
  assert.equal(vm.periodRows[0].big,'9 lượt'); assert.equal(vm.periodRows[0].small,'2h');
  assert.match(vm.periodRows[0].sub,/3 bài trong kỳ.*01\/10/);
  assert.equal(vm.periodRows[0].hot,true);
  assert.equal(vm.periodRows[0].img,'https://example.test/artist.jpg');
  assert.ok(!vm.periodSortChips.some(x=>x.label==='Điểm All time'));
  p.periodSort='Điểm All time';
  assert.equal(app.buildVM(ctx).periodRows[0].big,'9 lượt');
  assert.ok(paths.includes('/overview?scope=2026-08&asOf=2026-08-31&limit=5000'));
});

test('missing comparison data does not label period songs as new or borrow all-time rank changes',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname==='/artwork') return new Response(JSON.stringify({artists:{},tracks:{},albums:{}}));
    if(u.pathname==='/overview' && u.searchParams.get('scope')==='2024') return new Response(JSON.stringify({totals:{},months:[],songs:[{track_id:'TRNoHistory',title:'No history',plays:1}]}));
    return new Response(JSON.stringify({error:'offline'}),{status:503});
  };
  const ctx={p:{...app.BASE},screen:'periodTop',id:'songs~2024~2024-12-31',set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  app.buildVM(ctx);await new Promise(setImmediate);
  const vm=app.buildVM(ctx);
  assert.equal(vm.periodRows[0].change,null);
  assert.equal(vm.periodRows[0].chg,'–');
  assert.match(vm.periodRows[0].peak,/Chưa (tải được|có lịch sử)/);
  assert.equal(vm.periodRows[0].spark,null);
});


test('weekday average includes silent days and excludes current week and future plays', async () => {
  const {env,db}=fixture();
  try {
    db.exec("DELETE FROM plays");
    for (const date of ['2024-06-03','2024-06-03','2024-06-02','2024-06-17','2024-06-17','2024-06-17','2024-06-21']) {
      db.prepare('INSERT INTO plays VALUES (?,?,?)').run('TRA',date,10);
    }
    db.prepare('INSERT INTO plays VALUES (?,?,?)').run(null,'2024-06-03',10);
    const days=await app.dailyThisWeek(env,'2024-06-18');
    assert.equal(days[0].average,1);
    assert.equal(days[0].plays,3);
    assert.equal(days[0].lastWeek,0);
    assert.equal(days[6].average,1/3);
    assert.equal(days[4].future,true);
    assert.equal(days[4].plays,null);
    assert.equal(days[4].average,0);
    const firstWeek=await app.dailyThisWeek(env,'2024-06-01');
    assert.ok(firstWeek.every(d=>d.average===0));
  } finally { db.close(); }
});


test('period rank checkpoints stop at asOf and use days in a month, months in a year', () => {
  assert.equal(app.rankCheckpoints('2024-02','2024-03-02').dates.length,29);
  assert.deepEqual(app.rankCheckpoints('2026','2026-03-02').dates,['2026-01-31','2026-02-28','2026-03-02']);
  assert.equal(app.rankCheckpoints('2026-10','2026-10-02').dates.length,2);
  assert.equal(app.rankCheckpoints('2026-11','2026-10-02').dates.length,0);
});

test('period history uses scoped ranks, keeps gaps, and final ranks match the selected list', async () => {
  const {env,db}=fixture();
  try {
    for (const kind of ['artists','songs']) {
      const h=await app.periodRankHistory(env,'2026-10','2026-10-02',kind,'hours');
      const o=await app.overview(env,'2026-10','2026-10-02',5000);
      assert.deepEqual(h.dates,['2026-10-01','2026-10-02']);
      assert.equal(h.rows[0].id,kind==='artists'?o.artists[0].name:o.songs[0].track_id);
      assert.deepEqual(h.rows[0].ranks,[null,1]);
      assert.deepEqual(h.rows[1].ranks,[1,2]);
    }
    db.prepare('INSERT INTO plays VALUES (?,?,?)').run('TRB','2026-10-02',10);
    const plays=await app.periodRankHistory(env,'2026-10','2026-10-02','artists','plays');
    assert.equal(plays.rows[0].id,'Artist B');
    assert.equal(plays.rows[0].ranks.at(-1),1);
    const none=await app.periodRankHistory(env,'2026-11','2026-10-02','songs','hours');
    assert.deepEqual(none.rows,[]);
  } finally { db.close(); }
});

test('Home month-song history uses the same exclusions and ranking as the monthly list', async () => {
  const {env,db}=fixture();
  try {
    db.exec("ALTER TABLE tracks ADD COLUMN comments TEXT; ALTER TABLE plays ADD COLUMN id INTEGER; ALTER TABLE plays ADD COLUMN lark_record INTEGER; ALTER TABLE plays ADD COLUMN played_at INTEGER; ALTER TABLE plays ADD COLUMN title TEXT; ALTER TABLE plays ADD COLUMN album TEXT; UPDATE plays SET id=rowid, title='test', album='Album';");
    const history=await app.periodRankHistory(env,'2026-10','2026-10-02','monthSongs','hours');
    const rows=await app.periodSongRank(env,'month','2026-10-01','2026-10-02',5000);
    assert.deepEqual(history.rows.map(r=>[r.id,r.rank]),rows.map(r=>[r.track_id,r.rank]));
  } finally { db.close(); }
});


test('artist history is confined to its tab in both All time and period pages', () => {
  for (const screen of [app.ArtistsAllScreen,app.PeriodTopScreen]) {
    const vm={sampleChip:false,sortChips:[],periodSortChips:[],periodIsArtists:true,
      artistRows:[{name:'VISIBLE_ARTIST_ROW'}],periodRows:[{name:'VISIBLE_ARTIST_ROW'}],
      rankHistoryTitle:'History',rankHistoryChart:'VISIBLE_HISTORY_CHART',rankHistoryNote:'',periodNote:''};
    const list=app.renderToStaticMarkup(app.createElement(screen,{vm,c:{p:{...app.BASE}}}));
    assert.ok(list.includes('VISIBLE_ARTIST_ROW'));
    assert.ok(!list.includes('VISIBLE_HISTORY_CHART'));
    const history=app.renderToStaticMarkup(app.createElement(screen,{vm:{...vm,artistIsHistory:true,periodIsHistory:true},c:{p:{...app.BASE}}}));
    assert.ok(history.includes('VISIBLE_HISTORY_CHART'));
    assert.ok(!history.includes('VISIBLE_ARTIST_ROW'));
  }
});

test('All time history keeps every artist from the hours list and moves Points after Plays', async () => {
  app.invalidate(() => true);
  const rows=Array.from({length:100},(_,i)=>({artist:`Artist ${i+1}`,rank:i+1,hours:100-i,plays:100-i}));
  const requests=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);requests.push(u.pathname+u.search);
    const data=u.pathname==='/artists/alltime'?{rows}
      :u.pathname==='/history/artists'?{periods:['T09/26'],rows:rows.slice(0,99).map(r=>({...r,history:[{period:'T09/26',rank:r.rank+2}]}))}
      :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows:[]};
    return new Response(JSON.stringify(data),{status:200});
  };
  const p={...app.BASE,sort:'Lịch sử'},ctx={p,screen:'artistsAll',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx);
  assert.deepEqual(vm.sortChips.map(c=>c.label),['Giờ nghe','Lượt','Điểm','Đang lên','Mới vào','Lịch sử']);
  assert.equal(vm.artistRows.length,100);
  assert.equal(vm.rankHistoryTitle,'100 nghệ sĩ · lịch sử All time');
  assert.ok(requests.includes('/artists/alltime?sort=hours&limit=100'));
  const chart=app.renderToStaticMarkup(vm.rankHistoryChart);
  assert.ok(chart.includes('100  Artist 100'));
  assert.ok(chart.includes('Artist 99'));
  assert.ok(!chart.includes('#101')); // Ranks below the current list cutoff are not drawn.
  assert.ok(chart.includes('viewBox="0 0 342 2230"')); // Height ends at current rank 100.
  assert.ok(!chart.includes('Artist 100 · 09/26')); // Do not invent its missing history.
});


test('song charts are confined to History in All time and period pages', () => {
  for (const screen of [app.Top100Screen,app.PeriodTopScreen]) {
    const vm={sampleChip:false,filterChips:[],periodFilterChips:[],songViewTabs:[],periodIsArtists:false,
      top100Rows:[{title:'VISIBLE_SONG_ROW'}],periodRows:[{title:'VISIBLE_SONG_ROW'}],
      rankHistoryTitle:'History',rankHistoryChart:'VISIBLE_HISTORY_CHART',rankHistoryNote:'',periodNote:''};
    const list=app.renderToStaticMarkup(app.createElement(screen,{vm,c:{p:{...app.BASE}}}));
    assert.ok(list.includes('VISIBLE_SONG_ROW'));
    assert.ok(!list.includes('VISIBLE_HISTORY_CHART'));
    const history=app.renderToStaticMarkup(app.createElement(screen,{vm:{...vm,songIsHistory:true,periodIsHistory:true},c:{p:{...app.BASE}}}));
    assert.ok(history.includes('VISIBLE_HISTORY_CHART'));
    assert.ok(!history.includes('VISIBLE_SONG_ROW'));
  }
});

test('period histories show only top 25 while All time keeps the full list', async () => {
  for (const kind of ['artists','songs','monthSongs','allSongs']) {
    app.invalidate(()=>true);
    const rows=Array.from({length:36},(_,i)=>({name:`Artist ${i+1}`,artist:`Artist ${i+1}`,title:`Song ${i+1}`,track_id:`T${i+1}`,rank:i+1,plays:36-i,hours:36-i,
      history:[{period:'T09/26',rank:60}],previous:i+2}));
    globalThis.fetch=async url=>{
      const u=new URL(url);
      const data=u.pathname==='/overview'?{totals:{},months:[],artists:rows,songs:rows}
        :u.pathname==='/history/period'?{dates:['2026-09-01','2026-09-30'],daily:true,rows:rows.map(r=>({id:kind==='artists'?r.name:r.track_id,ranks:[60,r.rank]}))}
        :u.pathname==='/history/songs'?{periods:['T09/26'],rows}
        :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows};
      return new Response(JSON.stringify(data),{status:200});
    };
    const p={...app.BASE,periodSort:'Lịch sử',songView:'Lịch sử'};
    const ctx={p,screen:kind==='allSongs'?'top100':'periodTop',id:`${kind}~2026-09~2026-10-02`,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
    for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}
    const vm=app.buildVM(ctx);
    assert.ok(vm.rankHistoryTitle.startsWith(kind==='allSongs'?'36 ':'Top 25 '),kind);
    assert.equal((kind==='allSongs'?vm.top100Rows:vm.periodRows).length,36); // Only the history is limited.
    assert.deepEqual(vm.periodSortChips.map(c=>c.label),kind==='allSongs'?['Lượt','Giờ nghe','Lịch sử']:['Lượt','Giờ nghe','Tăng hạng','Mới vào','Mới thêm','Lịch sử']);
    const chart=app.renderToStaticMarkup(vm.rankHistoryChart);
    assert.ok(chart.includes(kind==='allSongs'?'36  Song 36':kind==='artists'?'25  Artist 25':'25  Song 25'),kind);
    if(kind!=='allSongs') assert.ok(!chart.includes('26  '),kind);
    assert.ok(!chart.includes('#60'),kind);
    assert.ok(chart.includes(kind==='allSongs'?'viewBox="0 0 342 822"':'viewBox="0 0 342 580"'),kind);
  }
});


test('Trends no longer loads period boards and hides the standalone history chart', async () => {
  app.invalidate(()=>true);
  const requests=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);requests.push(u.pathname);
    return new Response(JSON.stringify(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{periods:[],rows:[],rising:[]}),{status:200});
  };
  const p={...app.BASE},c={p,screen:'trend',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);
  assert.ok(!requests.includes('/board'));
  assert.equal(vm.board,undefined);
  assert.equal(vm.unavailable,undefined);
  const html=app.renderToStaticMarkup(app.createElement(app.TrendScreen,{vm,c}));
  assert.ok(!html.includes('Top 1–3 theo kỳ'));
  assert.ok(!html.includes('Top 10 bài · 12 tháng'));
  assert.ok(html.includes('Nghệ sĩ đang lên'));
});

test('Trends month chips load the selected historical month', async () => {
  app.invalidate(()=>true);
  const requests=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);requests.push(u.pathname+u.search);
    if(u.pathname==='/summary') return Response.json({asOf:'2026-10-18',week:{},month:{},year:{},total:{}});
    if(u.pathname==='/artwork') return Response.json({artists:{},tracks:{},albums:{}});
    if(u.pathname==='/overview') return Response.json({totals:{plays:9,songs:3,artists:3,albums:3,genres:1},months:[{month:'2026-08',plays:9,hours:2}],monthArtists:[{month:'2026-08',artist:'Artist A',hours:1}],artists:[{name:'Artist A',hours:1,plays:4},{name:'Artist B',hours:.6,plays:3},{name:'Artist C',hours:.4,plays:2}],songs:[{track_id:'A',title:'Song A',artist:'Artist A',plays:4,hours:1},{track_id:'B',title:'Song B',artist:'Artist B',plays:3,hours:.6},{track_id:'C',title:'Song C',artist:'Artist C',plays:2,hours:.4}],albums:[{name:'Album A',artist:'Artist A',plays:4,hours:1},{name:'Album B',artist:'Artist B',plays:3,hours:.6},{name:'Album C',artist:'Artist C',plays:2,hours:.4}],genres:[],byDay:[],byWeekday:[],byHour:[]});
    return Response.json({rows:[],artists:[],songs:[]});
  };
  const p={...app.BASE,trendMode:'Tháng',trendAsOf:'2026-08-31',scope:'Tháng'};
  const base={p,screen:'overview',id:'trend~2026-08-31',set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<5;i++){app.buildVM(base);await new Promise(setImmediate);}
  const vm=app.buildVM(base);
  assert.ok(requests.some(path=>path.startsWith('/overview?scope=2026-08&asOf=2026-08-31')));
  assert.equal(vm.trendMonthChips.find(chip=>chip.active).label,'T08/26');
  assert.equal(vm.dayTitle,'M08/26');
  assert.equal(vm.topArtistsTitle,'Top 6 Artists M08/26');
  assert.equal(vm.topSongsTitle,'Top 10 Songs M08/26');
  assert.deepEqual(vm.trendTabs.map(tab=>tab.label),['Đang lên hạng','Tháng 10','Năm 2026']);
  assert.equal(vm.rd.hours,'T08/26·2h·#1 Artist A');
  assert.deepEqual(vm.monthSummary.blocks.map(block=>block.label),['Top artist','Top album','Top song','Tăng hạng']);
  assert.deepEqual(vm.monthSummary.blocks.slice(0,3).map(block=>block.rows.length),[3,3,3]);
  vm.trendMonthChips.find(chip=>chip.label==='T07/26').onTap();
  assert.equal(p.trendAsOf,'2026-07-31');
});


test('month week comparison preserves Monday–Sunday slots and excludes outside/future days', () => {
  const sep=app.monthWeeks('2026-09','2026-10-02',Array.from({length:30},(_,i)=>i+1));
  assert.equal(sep.length,5);
  assert.equal(sep[0].label,'31/08–06/09');
  assert.deepEqual(sep[0].values,[null,1,2,3,4,5,6]);
  assert.deepEqual(sep[4].values,[28,29,30,null,null,null,null]);
  assert.equal(sep.flatMap(w=>w.values).filter(v=>v!==null).reduce((sum,v)=>sum+v,0),465);
  const current=app.monthWeeks('2026-10','2026-10-02',Array(31).fill(0));
  assert.equal(current.length,1);
  assert.deepEqual(current[0].values,[null,null,null,0,0,null,null]);
  assert.equal(app.monthWeeks('2026-08','2026-10-02',Array(31).fill(1)).length,6);
  const leap=app.monthWeeks('2024-02','2024-03-01',Array(29).fill(1));
  assert.equal(leap.flatMap(w=>w.values).filter(v=>v!==null).length,29);
  const jan=app.monthWeeks('2027-01','2027-01-01',Array(31).fill(2));
  assert.equal(jan[0].start,'2026-12-28');
  assert.deepEqual(jan[0].values,[null,null,null,null,2,null,null]);
  const html=app.renderToStaticMarkup(app.createElement(app.MonthWeeksChart,{weeks:current}));
  assert.equal((html.match(/role="button"/g)||[]).length,7);
  assert.ok(html.includes('02/10 · 0 lượt'));
  assert.ok(!html.includes('03/10 · 0 lượt'));
  assert.ok(!html.includes('NaN'));
});


test('monthly stacked areas use cumulative weekday totals without counting missing days', () => {
  const weeks=app.monthWeeks('2026-09','2026-10-02',Array.from({length:30},(_,i)=>i+1));
  const {layers,totals}=app.stackMonthWeeks(weeks);
  assert.deepEqual(totals,[70,75,80,54,58,62,66]);
  assert.deepEqual(layers[0].lower,[0,0,0,0,0,0,0]);
  assert.deepEqual(layers[4].lower,[42,46,50,54,58,62,66]);
  assert.deepEqual(layers[4].upper,totals);
  assert.equal(weeks[4].values[3],null);
  const html=app.renderToStaticMarkup(app.createElement(app.MonthWeeksChart,{weeks}));
  const legend=html.split('</svg>')[0].split('<svg')[0];
  for(const total of [21,70,119,168,87])assert.ok(legend.includes(`>${total}<span class="t3"> lượt</span>`));
  assert.ok(!html.includes('Chạm từng thứ để xem'));
  assert.ok(!html.includes('Tổng 80 lượt'));
  assert.ok(!html.includes('aria-pressed="true"'));
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 7);
  assert.ok(html.includes('xếp chồng'));
  assert.ok(!html.includes('NaN'));
});


test('new additions use library dates and earliest artist date, with scoped plays and zero-play entries', async () => {
  const {env,db}=fixture();
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN date_added TEXT;
      ALTER TABLE tracks ADD COLUMN in_library INTEGER NOT NULL DEFAULT 1;
      UPDATE tracks SET date_added='2020-01-01' WHERE id='TRA';
      UPDATE tracks SET date_added='2026-01-10' WHERE id='TRB';
      INSERT INTO tracks(id,title,artist,album_artist,duration_s,date_added) VALUES
      ('NEW','New by old artist','Artist A',NULL,3600,'2026-09-01T23:00:00'),
      ('FRESH','Fresh song','Performer','New Artist',3600,'2026-09-04'),
      ('SILENT','Silent song','Silent Artist',NULL,60,'2026-09-15'),
      ('FUTURE','Future song','Future Artist',NULL,60,'2026-10-03'),
      ('UNKNOWN','Unknown date','Unknown Artist',NULL,60,NULL);
      INSERT INTO tracks(id,title,artist,duration_s,date_added,in_library) VALUES ('REMOVED','Removed song','Artist A',3600,'2026-09-05',0);
      INSERT INTO plays SELECT 'REMOVED','2026-09-25',1 FROM tracks;
      INSERT INTO plays VALUES ('NEW','2026-09-20',1),('NEW','2026-09-21',2),('NEW','2026-09-22',3),
      ('FRESH','2026-09-20',1),('FRESH','2026-09-21',1),('FRESH','2026-08-01',1),('FRESH','2026-10-03',1);`);
    const month=await app.newAdditions(env,'2026-09','2026-10-02');
    assert.deepEqual(month.artists.map(r=>r.name),['New Artist','Silent Artist']);
    assert.equal(month.artists[0].plays,2);
    assert.equal(month.artists[0].added,'2026-09-04');
    assert.deepEqual(month.songs.map(r=>r.track_id),['NEW','FRESH','SILENT']);
    assert.equal(month.songs[2].plays,0);
    assert.ok(!month.songs.some(r=>r.track_id==='REMOVED'));
    const year=await app.newAdditions(env,'2026','2026-10-02');
    assert.ok(year.artists.some(r=>r.name==='Artist B'));
    assert.ok(!year.artists.some(r=>r.name==='Artist A'));
    assert.ok(!year.songs.some(r=>['FUTURE','UNKNOWN','REMOVED'].includes(r.track_id)));
    assert.equal((await app.newAdditions(env,'2026-10','2026-10-02')).songs.length,0);
    assert.equal((await app.newAdditions(env,'2026-09','2026-10-02',1)).songs[0].track_id,'NEW');
    db.exec(`INSERT INTO tracks(id,title,artist,album_artist,duration_s,date_added,in_library) VALUES
      ('GONE','Deleted song','Gone Artist',NULL,3600,'2026-09-01',0),
      ('MIX0','Deleted first song','Performer','Mixed Artist',3600,'2026-09-02',0),
      ('MIX1','Retained song','Other Performer','Mixed Artist',3600,'2026-09-12',1),
      ('OLD0','Old deleted song','Old Artist',NULL,60,'2025-01-01',0),
      ('OLD1','New retained song','Old Artist',NULL,60,'2026-09-15',1);
      INSERT INTO plays SELECT 'GONE','2026-09-25',1 FROM tracks;
      INSERT INTO plays VALUES ('MIX0','2026-09-20',1);`);
    for (const scope of ['2026-09','2026']) {
      const data=await app.newAdditions(env,scope,'2026-10-02');
      assert.ok(!data.artists.some(r=>r.name==='Gone Artist'));
      assert.ok(!data.artists.some(r=>r.name==='Old Artist'));
      const mixed=data.artists.find(r=>r.name==='Mixed Artist');
      assert.ok(mixed);
      assert.equal(mixed.tracks,1);
      assert.equal(mixed.added,'2026-09-02');
    }
    assert.equal((await app.newAdditions(env,'2026-09','2026-10-02',1)).artists[0].name,'New Artist');
    db.exec("UPDATE tracks SET in_library=0 WHERE id='MIX1'");
    assert.ok(!(await app.newAdditions(env,'2026-09','2026-10-02')).artists.some(r=>r.name==='Mixed Artist'));

  } finally { db.close(); }
});

test('new addition filters exist only inside period lists and update in place without navigation', async () => {
  for (const scope of ['Tháng trước','Tháng','Năm']) {
    app.invalidate(()=>true);
    const calls=[],nav=[],p={...app.BASE,scope};
    globalThis.fetch=async url=>{
      const u=new URL(url);calls.push(u.pathname+u.search);
      const period={plays:5};
      const data=u.pathname==='/summary'?{asOf:'2026-10-02',week:period,month:period,year:period,total:period}:
        u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:
        u.pathname==='/new-additions'?{artists:[{name:'New Artist',plays:2,hours:1,tracks:1,added:'2026-09-01'}],songs:[{track_id:'NEW',title:'New Song',artist:'Old Artist',plays:1,added:'2026-09-02'}]}:
        u.pathname==='/overview'?{totals:{plays:5},months:[],artists:[{name:'Old Artist',plays:5,hours:5}],songs:[{track_id:'OLD',title:'Old Song',plays:5}]}:{rows:[]};
      return new Response(JSON.stringify(data),{status:200});
    };
    const c={p,screen:'overview',id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>nav.push(args),goTab:()=>{},later:()=>{},ptoast:()=>{}};
    for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
    let vm=app.buildVM(c);
    assert.equal(vm.hourArtists[0].name,'Old Artist');
    assert.equal(vm.top15[0].title,'Old Song');
    assert.ok(!app.renderToStaticMarkup(app.createElement(app.OverviewScreen,{vm,c})).includes('Mới thêm'));
    const expected=scope==='Tháng trước'?'2026-09':scope==='Tháng'?'2026-10':'2026';
    if (expected === 'all' || /^\d{4}(-\d{2})?$/.test(expected)) assert.ok(calls.some(path=>path.startsWith(`/new-additions?scope=${expected}`)));
    else assert.ok(!calls.some(path=>path.startsWith('/new-additions')));
    vm.viewArtists();vm.viewSongs();
    assert.deepEqual(nav,[['periodTop',`artists~${expected}~2026-10-02`],['periodTop',`songs~${expected}~2026-10-02`]]);
    for(const kind of ['artists','songs']) {
      c.screen='periodTop';c.id=`${kind}~${expected}~2026-10-02`;
      p.periodFilter='Tất cả';p.periodSort='Giờ nghe';p.songView='Danh sách';
      for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
      vm=app.buildVM(c);
      assert.deepEqual(vm.periodFilterChips.map(tab=>tab.label),['Tất cả','Mới vào','Mới thêm']);
      vm.periodFilterChips.find(x=>x.label==='Mới thêm').onTap();
      for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
      vm=app.buildVM(c);
      assert.equal(vm.periodNewOnly,true);
      assert.equal(vm.periodIsHistory,false);
      assert.equal(vm.periodRows[0].title,kind==='artists'?'New Artist':'New Song');
      assert.equal(vm.periodRows[0].rank,1);
      assert.equal(vm.periodFilterChips.find(x=>x.label==='Mới thêm').active,true);
      const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{vm,c}));
      assert.equal((html.match(/>Mới thêm</g)||[]).length,1);
      assert.ok(html.indexOf('Mới thêm')>html.indexOf(kind==='artists'?'Giờ nghe':'Danh sách'));
      assert.equal(nav.length,2);
      vm.periodFilterChips[0].onTap();
      for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
      vm=app.buildVM(c);
      assert.equal(vm.periodRows[0].title,kind==='artists'?'Old Artist':'Old Song');
      assert.equal(vm.periodNewOnly,false);
      assert.equal(nav.length,2);
    }
  }
});

test('Back follows page parents, skipping filters and sibling details', () => {
  const top={screen:'periodTop',id:'songs~2026-09~2026-10-02'};
  let parents=app.rememberParent(top,{screen:'song',id:'A'},2,{});
  assert.deepEqual(app.parentPage({screen:'song',id:'A'},2,parents),top);
  parents=app.rememberParent({screen:'song',id:'A'},{screen:'artist',id:'B'},2,parents);
  parents=app.rememberParent({screen:'artist',id:'B'},{screen:'song',id:'C'},2,parents);
  assert.deepEqual(app.parentPage({screen:'song',id:'C'},2,parents),top);
  assert.deepEqual(app.parentPage(top,2,parents),{screen:'overview'});
  assert.deepEqual(app.parentPage({screen:'periodTop',id:'monthSongs~2026-09~2026-09-30'},0,{}),{screen:'today'});
  for(const [screen,parent] of [['top100','overview'],['artistsAll','overview'],['rules','library'],['unmatched','library'],['rising','trend']])
    assert.equal(app.parentPage({screen},0,{}).screen,parent);
  assert.equal(app.parentPage({screen:'song',id:'deep-link'},4,{}).screen,'library');
});

test('period artists filter uses All time gains independently of period ranks and sorting', async () => {
  app.invalidate(()=>true);
  const previous=[{name:'Falling',hours:4,plays:2},{name:'Steady',hours:3,plays:3},{name:'Rising',hours:2,plays:4}];
  const current=[{name:'Rising',hours:5,plays:8},{name:'Steady',hours:3,plays:3},{name:'Falling',hours:2,plays:1},{name:'New',hours:1,plays:1}];
  globalThis.fetch=async url=>{
    const u=new URL(url);
    const body=u.pathname==='/overview'?{totals:{},months:[],songs:[],artists:u.searchParams.get('scope')==='2026-08'?previous:current}
      :u.pathname==='/charts/artists'?{rows:u.searchParams.get('asOf')==='2026-08-31'?[{artist:'Steady',rank:13},{artist:'Rising',rank:4}]:[{artist:'Steady',rank:10},{artist:'Rising',rank:5},{artist:'New',rank:40}]}
      :u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:{rows:[]};
    return new Response(JSON.stringify(body));
  };
  const p={...app.BASE,periodFilter:'Tất cả',periodSort:'Giờ nghe'};
  const ctx={p,screen:'periodTop',id:'artists~2026-09~2026-09-30',set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const settle=async()=>{for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}return app.buildVM(ctx);};
  let vm=await settle();
  assert.deepEqual(vm.periodFilterChips.map(x=>x.label),['Tất cả','Mới vào','Mới thêm']);
  (ctx.id.startsWith('artists')?vm.periodSortChips:vm.songViewTabs).find(x=>x.label==='Tăng hạng').onTap();
  vm=await settle();
  assert.equal((ctx.id.startsWith('artists')?vm.periodSortChips:vm.songViewTabs).find(x=>x.label==='Tăng hạng').active,true);
  assert.deepEqual(vm.periodRows.map(r=>[r.name,r.rank,r.change]),[['Steady',2,3]]);
  p.periodFilter='Mới vào';vm=await settle();
  assert.deepEqual(vm.periodRows.map(r=>[r.name,r.rank]),[['New',4]]);
  p.periodFilter='Đang lên';p.periodSort='Lượt';vm=await settle();
  assert.deepEqual(vm.periodRows.map(r=>[r.name,r.rank,r.change]),[['Steady',2,3]]);
  assert.deepEqual(vm.periodRows.map(r=>[r.ranks,r.sub,r.rise]),[['#13 → #10','3x · 3h',3]]);
  assert.deepEqual(vm.periodRisingGroups.map(g=>[g.month,g.rows.length]),[['T09/26',1]]);
  assert.match(vm.periodRisingNote,/All time.*31\/08\/2026.*30\/09\/2026/);
  vm.periodSortChips.find(x=>x.label==='Lượt').onTap();
  vm=await settle();
  assert.equal(p.periodFilter,'Tất cả');
  assert.equal(vm.periodSortChips.find(x=>x.label==='Lượt').active,true);
  assert.equal(vm.periodRows.length,4);
});

test('period list preference persists and limits both kinds, while All time always shows 100',()=>{
  const saved=new Map(); window.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  assert.equal(app.readPeriodListSize(),25);
  for(const size of [25,50,100]) {
    app.savePeriodListSize(size);assert.equal(app.readPeriodListSize(),size);
    assert.equal(app.listDisplayLimit(true,size),100);
    for(const artists of [false,true]) {
      const rows=Array.from({length:120},(_,i)=>({title:'Song '+i,name:'Artist '+i,artist:'Band',allTimeRank:i+1}));
      const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{vm:{periodRows:rows,periodIsArtists:artists,periodSortChips:[],songViewTabs:[]},c:{p:{periodListSize:size}}}));
      assert.equal((html.match(artists?/class="artist-tile(?: [^"]*)?"/g:/class="row song-row(?: [^"]*)?"/g)||[]).length,size);
    }
  }
  assert.equal(app.periodListSize(70),25);
});

test('Top Song always renders 100 rows regardless of the period list preference',()=>{
  const rows=Array.from({length:120},(_,i)=>({title:`Song ${i+1}`,artist:'Band',rank:i+1}));
  for(const size of [25,50,100]) {
    const html=app.renderToStaticMarkup(app.createElement(app.Top100Screen,{
      vm:{top100Rows:rows,songViewTabs:[],songRankMonthChips:[]},
      c:{p:{periodListSize:size}},
    }));
    assert.equal((html.match(/class="row song-row(?: [^"]*)?"/g)||[]).length,100);
  }
});

test('artist period promotion uses the compact grouped rows from Trends',()=>{
  const row={an:'Steady',name:'Steady',ini:'ST',sub:'3x · 3h',ranks:'#13 → #10',rise:3};
  const vm={periodIsArtists:true,periodRisingNote:'Tăng hạng All time',periodRisingGroups:[{month:'T09/26',rows:[row]}],periodRows:[row],periodSortChips:[],periodEmpty:''};
  const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{vm,c:{p:{periodListSize:25}}}));
  const text=html.replace(/<[^>]*>/g,'');
  assert.ok(html.includes('T09/26'));
  assert.ok(html.includes('>3x</strong>'));
  assert.ok(html.includes('>3h</span>'));
  assert.ok(text.includes('13▶10'));
  assert.ok(text.includes('All time▲3'));
  assert.ok(html.includes('song-metrics-inline'));
  assert.ok(!html.includes('artist-tile'));
});
test('recent page requests 25 plays and retains duplicate songs as separate listening events',async()=>{
  app.invalidate(()=>true);
  const paths=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);paths.push(u.pathname+u.search);
    const body=u.pathname==='/recent'?{rows:Array.from({length:25},(_,i)=>({track_id:'TR1',track_title:'Song',track_artist:'Artist',album:'Album',hour:23,minute:59-i,play_date:'2026-10-02'}))}:u.pathname==='/artwork'?{}:{rows:[]};
    return Response.json(body);
  };
  const c={p:{...app.BASE},screen:'recent',id:null,set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);
  assert.ok(paths.includes('/recent?limit=25'));
  assert.equal(vm.recent.length,25);
  assert.equal(vm.recent[0].time,'23:59');assert.equal(vm.recent[24].time,'23:35');
  const html=app.renderToStaticMarkup(app.createElement(app.RecentScreen,{vm,c}));
  assert.equal((html.match(/class="row song-row(?: [^"]*)?"/g)||[]).length,25);
  assert.deepEqual(app.parentPage({screen:'recent'},0,{}),{screen:'today'});
});


test('album ranking follows the shared 25/50/100 preference and All time shows 100',()=>{
  const albums=Array.from({length:120},(_,i)=>({ak:`Album ${i}`,title:`Album ${i}`,artist:'Artist',rank:i+1}));
  for(const size of [25,50,100]) for(const allTime of [false,true]){
    const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{
      vm:{periodIsAlbums:true,periodAllTime:allTime,albums,topPeriodTitle:'Top album · Test',periodNote:''},
      c:{p:{periodListSize:size}},
    }));
    assert.equal((html.match(/class="album-tile(?: [^"]*)?"/g)||[]).length,allTime?100:size);
    assert.ok(html.includes('1. '));
  }
});


test('artist rising filter compares the selected metric and preserves ranks',async()=>{
  app.invalidate(()=>true);const paths=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);paths.push(u.pathname+u.search);
    const previous=u.searchParams.has('asOf');
    const rows=previous?[{artist:'B',rank:1,plays:40,hours:10,points:5,pointsRank:1},{artist:'A',rank:2,plays:30,hours:8,points:3,pointsRank:2}]:[{artist:'A',rank:1,plays:60,hours:12,points:7,pointsRank:1},{artist:'B',rank:2,plays:40,hours:10,points:5,pointsRank:2}];
    return Response.json(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:u.pathname==='/artists/alltime'?{rows}:{rows:[]});
  };
  const p={...app.BASE,artistFilter:'Đang lên'},c={p,screen:'artistsAll',id:null,set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(const sort of ['Giờ nghe','Lượt','Điểm']){
    p.sort=sort;for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
    const vm=app.buildVM(c);assert.deepEqual(vm.artistRows.map(r=>[r.name,r.rank,r.change]),[['A',1,1]]);
  }
  assert.ok(paths.some(x=>x.includes('sort=plays')&&x.includes('asOf=')));
  assert.ok(paths.some(x=>x.includes('sort=points')&&x.includes('asOf=')));
});


test('monthly song list calculates listening time from scoped plays and exact duration',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    const body=u.pathname==='/library/tracks'?{rows:[{id:'long',title:'Long',artist:'A',album:'B',duration_s:453,in_library:1}]}:
      u.pathname==='/charts/songs'?{rows:[{track_id:'long',title:'Long',artist:'A',plays:9,rank:1}]}:
      u.pathname==='/artwork'?{artists:{},albums:{},tracks:{}}:{rows:[]};
    return Response.json(body);
  };
  const c={p:{...app.BASE},screen:'periodTop',id:'monthSongs~2026-09~2026-09-30',set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);assert.equal(vm.periodRows[0].listening,'1h 8m');assert.equal(vm.periodRows[0].duration_s,453);
});


test('song rank timeline starts May 2024, carries ranks through missing months, and ends at current rank',()=>{
  const result=app.songRankTimeline([{period:'T05/24',rank:1},{period:'T10/24',rank:30},{period:'T12/24',rank:20},{period:'T09/26',rank:60},{period:'T11/26',rank:5}],'2026-10-03',45);
  assert.equal(result.labels.length,30);
  assert.deepEqual(result.labels.slice(0,4),['05/24','06/24','07/24','08/24']);
  assert.deepEqual(result.ranks.slice(0,4),[1,1,1,1]);
  assert.deepEqual(result.ranks.slice(5,9),[30,30,20,20]);
  const late=app.songRankTimeline([{period:'T07/24',rank:80},{period:'T10/24',rank:70}],'2025-01-03',60);
  assert.deepEqual(late.ranks,[null,null,80,80,80,70,70,70,60]);
  assert.deepEqual(result.labels.slice(-2),['09/26','Hiện tại']);
  assert.deepEqual(result.ranks.slice(-2),[60,45]);
  assert.equal(app.songRankTimeline([], '2026-10-03').ranks.at(-1),null);
});

test('song detail monthly chart renders the full listening history',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname==='/song/TR-FULL') return Response.json({
      track:{id:'TR-FULL',title:'Full History',artist:'Artist',album:'Album',in_library:1},
      allTime:{rank:24,level:1,plays:110,minutes:400},rating:null,plays:{logged:5},
      months:[{month:'2024-05',plays:2},{month:'2026-10',plays:3}],rankHistory:[{period:'2024-05',rank:219},{period:'2026-07',rank:224},{period:'2026-10',rank:24}],
    });
    if(u.pathname==='/artwork') return Response.json({artists:{},albums:{},tracks:{}});
    return Response.json({rows:[]});
  };
  const c={p:{...app.BASE},screen:'song',id:'TR-FULL',set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c),html=app.renderToStaticMarkup(vm.ch.sh);
  assert.match(html,/05\/24/);
  assert.match(html,/10\/26/);
  assert.match(html,/Lượt nghe và lịch sử hạng theo tháng/);
  assert.match(html,/var\(--song-history-plays\)/);
  assert.match(html,/var\(--song-history-rank\)/);
  assert.match(html,/#1/);
  assert.match(html,/#110/);
  assert.match(html,/#219/);
  assert.match(html,/#224/);
  assert.match(html,/>#24<\/text>/);
  assert.doesNotMatch(html,/>Lượt nghe<\/text>/);
  assert.doesNotMatch(html,/>Hạng<\/text>/);
  assert.equal((html.match(/mix-blend-mode:screen/g) || []).length,2);
  assert.equal(vm.rd.sh,'T10/26 · 3 lượt · hạng #24');
});

test('song detail All time change compares with the best recorded rank',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname==='/song/TR-BEST') return Response.json({
      track:{id:'TR-BEST',title:'Best Rank',artist:'Artist',album:'Album',in_library:1},
      allTime:{rank:87,level:1,plays:56,minutes:240},rating:null,plays:{logged:5},months:[],
      rankHistory:[{period:'T06/24',rank:19},{period:'T09/26',rank:68}],
    });
    if(u.pathname==='/artwork') return Response.json({artists:{},albums:{},tracks:{}});
    return Response.json({rows:[]});
  };
  const c={p:{...app.BASE},screen:'song',id:'TR-BEST',set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c),html=app.renderToStaticMarkup(vm.song.chg);
  assert.match(html,/▼68/);
});

test('song history uses the Top 100 scale when its first rank is inside the Top 100',()=>{
  const chart=app.songHistoryChart([1,2,3],[80,105,60],['01/26','02/26','03/26'],{currentRank:60});
  const html=app.renderToStaticMarkup(chart);
  assert.match(html,/>#1<\/text>/);
  assert.match(html,/>#50<\/text>/);
  assert.match(html,/>#100<\/text>/);
  assert.match(html,/02\/26 · hạng #105/);
  assert.equal((html.match(/mix-blend-mode:screen/g) || []).length,2);
});

test('song history rounds the middle rank milestone to a 25-rank step',()=>{
  const chart=app.songHistoryChart([0,1,2],[229,213,208],['07/25','08/25','09/25'],{currentRank:88});
  const html=app.renderToStaticMarkup(chart);
  assert.match(html,/>#125<\/text>/);
  assert.doesNotMatch(html,/>#115<\/text>/);
  assert.match(html,/>#229<\/text>/);
});

test('artist and album history use the Top 50 scale when their first rank is inside the Top 50',()=>{
  const chart=app.songHistoryChart([1,2,3],[23,55,9],['01/26','02/26','03/26'],{currentRank:9,rankThreshold:50});
  const html=app.renderToStaticMarkup(chart);
  assert.match(html,/>#1<\/text>/);
  assert.match(html,/>#25<\/text>/);
  assert.match(html,/>#50<\/text>/);
  assert.match(html,/02\/26 · hạng #55/);
  assert.equal((html.match(/mix-blend-mode:screen/g) || []).length,2);
});

test('current rank replaces an overlapping axis milestone with a stronger unframed label',()=>{
  const chart=app.songHistoryChart([1,2],[50,40],['01/26','02/26'],{currentRank:50,rankThreshold:50});
  const html=app.renderToStaticMarkup(chart);
  assert.equal((html.match(/>#50<\/text>/g) || []).length,1);
  assert.equal((html.match(/data-current-rank="true"/g) || []).length,1);
  assert.doesNotMatch(html,/<rect[^>]+data-current-rank/);
  assert.match(html,/font-weight:800/);
  assert.match(html,/fill:var\(--song-history-current-rank\)/);
});

test('artist detail merges its full listening and All time rank history',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.pathname==='/artist/Aep') return Response.json({
      artist:'Aep',asOf:'2026-10-17',ranks:{at:1},library:{tracks:4,albums:1},allTime:{plays:20,hours:2},logged:{days:3},months:[{month:'2024-05',hours:1,totalHours:150},{month:'2026-10',hours:1,totalHours:22}],weeks:[],topSongs:[{track_id:'TR-AEP',title:'Song',rank:1,plays:20}],
    });
    if(u.pathname==='/history/artists') return Response.json({periods:['T05/24','T09/26','T10/26'],rows:[{artist:'Aep',history:[{period:'T05/24',rank:3},{period:'T09/26',rank:2},{period:'T10/26',rank:1}]}]});
    if(u.pathname==='/history/song-ranks') return Response.json({periods:['T05/24'],rows:[{track_id:'TR-AEP',best:{period:'T05/24',rank:12},history:[{period:'T05/24',rank:12}]}]});
    if(u.pathname==='/charts/songs') return Response.json({rows:[{track_id:'TR-AEP',rank:20}]});
    if(u.pathname==='/artwork') return Response.json({artists:{},albums:{},tracks:{}});
    return Response.json({rows:[]});
  };
  const c={p:{...app.BASE},screen:'artist',id:'Aep',set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<5;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c),html=app.renderToStaticMarkup(vm.ch.ah);
  assert.equal(vm.artist.songs[0].allTimeChange,-8);
  assert.match(html,/Giờ nghe và lịch sử hạng theo tháng của Aep/);
  assert.match(html,/05\/24/);
  assert.match(html,/10\/26/);
  assert.match(html,/Aep/);
  assert.doesNotMatch(html,/>Aep<\/text>/);
  assert.doesNotMatch(html,/>Tổng<\/text>/);
  assert.match(html,/>#1<\/text>/);
  assert.match(html,/#2/);
  assert.match(html,/#3/);
  assert.match(html,/120h/);
  assert.doesNotMatch(html,/150h/);
  assert.equal(vm.ch.ar,undefined);
  assert.equal(vm.rd.ah,'T10/26 · 1h · hạng #1');
});


test('song rank colors respect all tier boundaries and default for missing ranks',()=>{
  for(const [rank,color] of [[1,'--rank-chart-gold'],[10,'--rank-chart-gold'],[11,'--rank-chart-green'],[50,'--rank-chart-green'],[51,'--rank-chart-blue'],[80,'--rank-chart-blue'],[81,'--text2'],[100,'--text2'],[101,'--rank-chart-muted'],[undefined,'--text2']])
    assert.equal(app.songRankColor(rank),`var(${color})`);
});

test('new Top 100 entries require a known previous rank outside the chart',async()=>{
  app.invalidate(()=>true);
  const rows=[{track_id:'ENTER',rank:100,previous:101},{track_id:'STAY',rank:99,previous:100},{track_id:'UNKNOWN',rank:10,previous:null},{track_id:'OUTSIDE',rank:101,previous:150}].map(r=>({...r,title:r.track_id,artist:'Artist',plays:1,history:[]}));
  globalThis.fetch=async url=>new Response(JSON.stringify(new URL(url).pathname==='/history/songs'?{periods:['T09/26'],rows}:{rows:[]}));
  const p={...app.BASE,filter:'Mới vào'},c={p,screen:'top100',id:null,set:()=>{},go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  assert.deepEqual(app.buildVM(c).top100Rows.map(r=>r.tid),['ENTER']);
});

test('rising songs use current movement, exclude past risers now falling or flat, and keep recent plays first',async()=>{
 app.invalidate(()=>true);
 const start=Date.parse('2026-10-01T00:00:00+07:00')/1000;
 const rows=[
  {track_id:'TR1',title:'High rank, old play',rank:1,lastPlayedAt:start+100,lastMonth:{rise:2},rise:1},
  {track_id:'TR2',title:'Recent rising',rank:80,lastPlayedAt:start+300,lastMonth:{rise:0},rise:3},
  {track_id:'TR3',title:'Who You Really Are',rank:50,previous:49,lastPlayedAt:start+400,lastMonth:{rise:2},rise:-1},
  {track_id:'TR4',title:'No play date',rank:2,lastPlayedAt:null,lastMonth:{rise:-1},rise:1},
  {track_id:'TR5',title:'Now unchanged',rank:20,lastPlayedAt:start+500,lastMonth:{rise:1},rise:0},
  {track_id:'TR6',title:'No comparison',rank:30,lastPlayedAt:start+600,lastMonth:{rise:2},rise:null},
  {track_id:'OLD',title:'Old play despite rank gain',rank:37,lastPlayedAt:start-1,rise:1},
  {track_id:'BOUNDARY',title:'First play of month',rank:90,lastPlayedAt:start,rise:1},
  {track_id:'FUTURE',title:'Beyond data date',rank:3,lastPlayedAt:Date.parse('2026-10-05T00:00:00+07:00')/1000,rise:1},
  {track_id:'TR7',title:'Same play time, better rank',rank:40,lastPlayedAt:start+300,rise:2},
 ];
 globalThis.fetch=async url=>{const p=new URL(url).pathname;return Response.json(p==='/artwork'?{artists:{},tracks:{},albums:{}}:p==='/history/songs'?{asOf:'2026-10-04',periods:['T09/26'],rows}:{periods:[],rows:[],rising:[]});};
 for(const screen of ['trend','rising']){
  const p={...app.BASE},c={p,screen,id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);
  assert.deepEqual((screen==='trend'?vm.rising:vm.risingAll).map(r=>r.tid),['TR7','TR2','TR1','BOUNDARY']);
  if(screen==='trend')assert.equal(vm.risingCount,4);
  else assert.match(vm.risingHead,/Tháng hiện tại và tháng trước/);
  assert.deepEqual(vm.risingGroups.map(g=>g.month),['T10/26']);
 }
});


test('rising groups use month-end ranks and last play within each month, newest month first',async()=>{
 app.invalidate(()=>true);
 const at=date=>Date.parse(date+'T12:00:00+07:00')/1000;
 const h=(aug,sep)=>[{period:'T08/26',rank:aug},{period:'T09/26',rank:sep}];
 const current=[
  {track_id:'BOTH',title:'Rose in both months',rank:35,previous:40,rise:5,lastPlayedAt:at('2026-10-03'),history:h(50,40)},
  {track_id:'PAST',title:'Who You Really Are',rank:50,previous:49,rise:-1,lastPlayedAt:at('2026-09-29'),history:h(51,49)},
  {track_id:'OLD',title:'Stale play',rank:37,previous:38,rise:1,lastPlayedAt:at('2025-05-15'),history:h(39,38)},
 ];
 const past=current.map(r=>({...r,lastPlayedAt:r.track_id==='BOTH'?at('2026-09-30'):r.lastPlayedAt}));
 // The historical endpoint's recomputed rank differs; the group's rank must use saved snapshots.
 globalThis.fetch=async url=>{const u=new URL(url);return Response.json(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:u.pathname==='/history/songs'?{asOf:u.searchParams.get('asOf')||'2026-10-04',periods:['T08/26','T09/26'],rows:u.searchParams.has('asOf')?past:current}:u.pathname==='/history/artists'?{periods:['T08/26','T09/26'],rows:[],rising:[{period:'T09/26',rows:[{artist:'Artist rise',rank:10,previous:12,monthPlays:3,monthHours:1}]}]}:u.pathname==='/overview'?{totals:{},months:[],artists:[],songs:u.searchParams.get('scope')==='2026-10'?[{track_id:'BOTH',plays:4,hours:.5}]:[{track_id:'PAST',plays:9,hours:1.5},{track_id:'BOTH',plays:2,hours:.25}]}:{periods:[],rows:[],rising:[]});};
 for(const screen of ['trend','rising']){
  const nav=[],p={...app.BASE},c={p,screen,id:null,set:fn=>Object.assign(p,fn(p)),go:(...args)=>nav.push(args),goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<6;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);
  assert.deepEqual(vm.risingGroups.map(g=>[g.month,g.rows.map(r=>r.tid)]),[['T10/26',['BOTH']],['T09/26',['PAST','BOTH']]]);
  assert.deepEqual(vm.risingGroups[1].rows.map(r=>[r.risingPreviousRank,r.risingRank]),[[51,49],[50,40]]);
  assert.deepEqual(vm.risingGroups.map(g=>g.rows.map(r=>[r.tid,r.metric,r.listening])),[[['BOTH','4 lượt','30m']],[['PAST','9 lượt','1h 30m'],['BOTH','2 lượt','15m']]]);
  if(screen==='trend'){
   assert.equal(vm.risingCount,3);
   vm.risingArtists[0].onViewAll();vm.risingGroups[0].onViewAll();vm.risingGroups[1].onViewAll();
   const view={periodFilter:'Đang lên',periodSort:'Lượt',songView:'Danh sách'};
   assert.deepEqual(nav,[
    ['periodTop','artists~2026-09~2026-09-30',view],
    ['periodTop','songs~2026-10~2026-10-04',view],
    ['periodTop','songs~2026-09~2026-09-30',view],
   ]);
   const html=app.renderToStaticMarkup(app.createElement(app.TrendScreen,{vm,c}));
   assert.equal((html.match(/>Xem tất cả<\/button>/g)||[]).length,3);
   assert.ok(!html.includes('Xem tất cả (3)'));
   assert.ok(html.includes('rising-song-chart'));
   assert.ok(html.includes('song-rank-progress'));
  }
 }
});

test('monthly song rising filter uses saved All time ranks for the selected month and keeps monthly metrics',async()=>{
 app.invalidate(()=>true);
 const current=[{track_id:'MONTH',title:'Monthly rise only',rank:1,plays:10,hours:1},{track_id:'AT',title:'All time riser',rank:4,plays:3,hours:0.5}];
 const previous=[{track_id:'AT',rank:1},{track_id:'MONTH',rank:2}];
 const paths=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);paths.push(u.pathname+u.search);
  return Response.json(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:
   u.pathname==='/overview'?{totals:{},months:[],songs:u.searchParams.get('scope')==='2026-08'?previous:current,artists:[]}:
   u.pathname==='/history/songs'?{asOf:'2026-10-04',periods:['T08/26','T09/26'],rows:[
    {track_id:'MONTH',rank:35,history:[{period:'T08/26',rank:40},{period:'T09/26',rank:45}]},
    {track_id:'AT',rank:65,history:[{period:'T08/26',rank:70},{period:'T09/26',rank:60}]},
   ]}:{rows:[]});
 };
 const p={...app.BASE,periodFilter:'Đang lên'},c={p,screen:'periodTop',id:'songs~2026-09~2026-10-04',set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
 for(let i=0;i<4;i++){app.buildVM(c);await new Promise(setImmediate);}
 const vm=app.buildVM(c);
 assert.deepEqual(vm.periodRows.map(r=>[r.tid,r.rank,r.change,r.metric]),[['AT',4,10,'3 lượt']]);
 assert.deepEqual(vm.periodRows.map(r=>[r.risingPreviousRank,r.risingRank,r.risingGain]),[[70,60,10]]);
 assert.ok(vm.periodRows[0].spark);
 const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{vm,c}));
 assert.ok(html.includes('rising-song-chart'));
 assert.ok(html.includes('song-metrics-inline'));
 assert.ok(html.includes('70') && html.includes('60'));
 assert.ok(html.replace(/<[^>]*>/g,'').includes('70▶60'));
 assert.ok(!html.replace(/<[^>]*>/g,'').includes('+10'));
 assert.match(vm.periodRisingNote,/All time.*31\/08\/2026.*30\/09\/2026/);
});


test('Top 100 history ignores list filters and includes May 2024 checkpoints', async () => {
  app.invalidate(()=>true);
  const rows=Array.from({length:100},(_,i)=>({track_id:`T${i+1}`,title:`Song ${i+1}`,artist:'Artist',rank:i+1,previous:i+1,rise:i===0?1:0,plays:100-i,history:[{period:'T04/24',rank:i+1},{period:'T05/24',rank:i+1},{period:'T09/26',rank:i+1}]}));
  globalThis.fetch=async url=>new Response(JSON.stringify(new URL(url).pathname==='/history/songs'?{periods:['T04/24','T05/24','T09/26'],rows}:{rows:[],artists:{},tracks:{},albums:{}}),{status:200});
  const p={...app.BASE,filter:'Đang lên',songView:'Lịch sử'};
  const ctx={p,screen:'top100',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<3;i++){app.buildVM(ctx);await new Promise(setImmediate);}
  const vm=app.buildVM(ctx), chart=app.renderToStaticMarkup(vm.rankHistoryChart);
  assert.equal(vm.top100Rows.length,1);
  assert.equal(vm.rankHistoryTitle,'100 bài hát · lịch sử All time');
  assert.ok(chart.includes('Song 100'));
  assert.ok(chart.includes('05/24'));
  assert.ok(!chart.includes('04/24'));
});


test('missing August and September 2024 ranks retain July, without filling unrelated or leading gaps',()=>{
 const periods=['2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11'];
 assert.deepEqual(app.ranksWithHistoricalGaps([{period:'T07/24',rank:12},{period:'T10/24',rank:9}],periods),[null,null,12,12,12,9,null]);
 assert.deepEqual(app.ranksWithHistoricalGaps([{period:'T09/24',rank:7}],periods),[null,null,null,null,7,null,null]);
});


test('monthly song tabs include additions and List clears every filter',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url);
    return Response.json(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:
      u.pathname==='/new-additions'?{songs:[{track_id:'new',title:'New Song',artist:'A',added:'2026-10-01',plays:0,hours:0}],artists:[]}:
      u.pathname==='/charts/songs'?{rows:[{track_id:'old',title:'Old Song',artist:'A',rank:1,plays:3,previous:2}]}:{rows:[]});
  };
  const p={...app.BASE},c={p,screen:'periodTop',id:'monthSongs~2026-10~2026-10-05',set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  const load=async()=>{for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}return app.buildVM(c);};
  let vm=await load();
  assert.deepEqual(vm.songViewTabs.map(x=>x.label),['Danh sách','Tăng hạng','Mới vào','Mới thêm','Lịch sử']);
  vm.songViewTabs.find(x=>x.label==='Mới thêm').onTap();vm=await load();
  assert.equal(vm.periodRows[0].title,'New Song');
  assert.equal(vm.songViewTabs.find(x=>x.label==='Mới thêm').active,true);
  const html=app.renderToStaticMarkup(app.createElement(app.PeriodTopScreen,{vm,c}));
  assert.equal((html.match(/>Mới thêm</g)||[]).length,1);
  for(const filter of ['Đang lên','Mới vào','Mới thêm']){
    p.periodFilter=filter;vm=await load();vm.songViewTabs.find(x=>x.label==='Danh sách').onTap();
    assert.equal(p.periodFilter,'Tất cả');assert.equal(p.songView,'Danh sách');
  }
  vm=await load();assert.equal(vm.periodRows[0].title,'Old Song');
});

test('artist newcomer tab includes only entrants into the current top 100',async()=>{
  app.invalidate(()=>true);
  globalThis.fetch=async url=>{
    const u=new URL(url),previous=u.searchParams.has('asOf');
    const rows=previous?[{artist:'Stayer',rank:2,hours:8},{artist:'Entrant',rank:101,hours:1}]:
      [{artist:'Stayer',rank:1,hours:10},{artist:'Entrant',rank:2,hours:9},{artist:'New artist',rank:3,hours:8}];
    return Response.json(u.pathname==='/artwork'?{artists:{},tracks:{},albums:{}}:u.pathname==='/artists/alltime'?{rows}:{rows:[]});
  };
  const p={...app.BASE,artistFilter:'Mới vào'},c={p,screen:'artistsAll',id:null,set:fn=>Object.assign(p,fn(p)),go:()=>{},goTab:()=>{},later:()=>{},ptoast:()=>{}};
  for(let i=0;i<3;i++){app.buildVM(c);await new Promise(setImmediate);}
  const vm=app.buildVM(c);
  assert.deepEqual(vm.artistRows.map(x=>x.name),['Entrant','New artist']);
  assert.equal(vm.sortChips.find(x=>x.label==='Mới vào').active,true);
  vm.sortChips.find(x=>x.label==='Giờ nghe').onTap();assert.equal(p.artistFilter,'Tất cả');
  vm.sortChips.find(x=>x.label==='Lịch sử').onTap();assert.equal(p.sort,'Lịch sử');
});
