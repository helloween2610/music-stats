import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
globalThis.window={
  localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  dispatchEvent:()=>{},
};
const compiled=await build({entryPoints:['src/lib/playlists.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':'./src'},define:{'import.meta.env':'{}'}});
const {buildPlaylistPeriodRows,buildPlaylistRankRows,peekPlaylistSnapshot,playlistLibraryIndex,playlistMetricMode,playlistsContainingTrack,sortPlaylistRows,sortPlaylistsByRank,usablePlaylistSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const playlistScreen=await readFile('src/screens/playlists.tsx','utf8');
const vmSource=await readFile('src/vm.ts','utf8');
test('outside-library playlist songs always use community counts, including Collection',()=>{
  const track={title:'Song'};
  for(const folder of ['_New Music','00_COLLECTION']) {
    assert.equal(playlistMetricMode(folder,track,true,false),'community');
    assert.equal(playlistMetricMode(folder,track,false,false),'waiting');
  }
  assert.equal(playlistMetricMode('_New Music',track,true,true),'community');
  assert.equal(playlistMetricMode('00_COLLECTION',track,true,true),'local');
});
test('playlist tracks resolve current library IDs by persistent ID, then exact identity only',()=>{
  const rows=[{id:'TR1',apple_pid:'PID1',title:'Renamed',artist:'Artist',album:'Album',in_library:1},
    {id:'TR2',apple_pid:'PID2',title:'Removed',artist:'Artist',album:'Album',in_library:0},
    {id:'TR3',title:'Online',artist:'Artist',album:'Album',in_library:1}];
  const find=playlistLibraryIndex(rows);
  assert.equal(find({persistentId:'PID1',title:'Old name'})?.id,'TR1');
  assert.equal(find({persistentId:'PID2',title:'Removed',artist:'Artist',album:'Album'}),undefined);
  assert.equal(find({title:'Online',artist:'ARTIST',album:'Album',inLibrary:false})?.id,'TR3');
  assert.equal(find({title:'Online',artist:'Artist',album:'Different album'}),undefined);
  assert.equal(playlistLibraryIndex([...rows,{...rows[2],id:'TR4'}])({title:'Online',artist:'Artist',album:'Album'}),undefined);
});

test('song menu finds each containing playlist by persistent ID or exact metadata',()=>{
  const snapshot={exportedAt:null,folders:['Folder'],playlists:[
    {id:'p1',name:'By PID',folder:'Folder',path:'Folder',items:['a','a']},
    {id:'p2',name:'By metadata',folder:'Folder',path:'Folder',items:['b']},
    {id:'p3',name:'Different album',folder:'Folder',path:'Folder',items:['c']},
  ],tracks:{
    a:{title:'Renamed',artist:'Artist',album:'Album',persistentId:'PID1'},
    b:{title:'Song',artist:'ARTIST',album:'Album'},
    c:{title:'Song',artist:'Artist',album:'Other'},
  }};
  assert.deepEqual(playlistsContainingTrack(snapshot,{title:'Song',artist:'Artist',album:'Album',persistentId:'pid1'}).map(playlist=>playlist.id),['p1','p2']);
  assert.deepEqual(playlistsContainingTrack(snapshot,{title:'Song',artist:'Artist',album:'Album'}).map(playlist=>playlist.id),['p2']);
  assert.deepEqual(playlistsContainingTrack(snapshot,{title:'Song',artist:'Artist'}).map(playlist=>playlist.id),['p2','p3']);
});

test('song menu puts highest-ranked containing playlists first and preserves source order for unranked playlists',()=>{
  const playlists=[
    {id:'p1',name:'Unranked first',folder:'Folder',path:'Folder',items:[]},
    {id:'p2',name:'Rank two',folder:'Folder',path:'Folder',items:[]},
    {id:'p3',name:'Rank one',folder:'Folder',path:'Folder',items:[]},
    {id:'p4',name:'Unranked last',folder:'Folder',path:'Folder',items:[]},
  ];
  assert.deepEqual(sortPlaylistsByRank(playlists,[{id:'p2',rank:2},{id:'p3',rank:1}],playlists).map(playlist=>playlist.id),['p3','p2','p1','p4']);
});

test('playlist sorting preserves duplicates, source order and puts missing years last',()=>{
  const rows=[{index:0,track:{title:'Z',year:2001}},{index:1,track:{title:'A',year:2024}},{index:2,track:{title:'A'}},{index:3,track:{title:'A',year:2024}}];
  assert.deepEqual(sortPlaylistRows(rows,'Tên bài').map(x=>x.index),[1,2,3,0]);
  assert.deepEqual(sortPlaylistRows(rows,'Năm mới nhất').map(x=>x.index),[1,3,0,2]);
  assert.deepEqual(sortPlaylistRows(rows,'Thứ tự gốc').map(x=>x.index),[0,1,2,3]);
  assert.deepEqual(rows.map(x=>x.index),[0,1,2,3]);
});

test('playlist ranking uses smooth coverage, recency power 1.5 and no level multiplier',()=>{
  const make=(id,count)=>({id,name:`Playlist ${count}`,folder:'00_COLLECTION',path:'00_COLLECTION',items:Array.from({length:count},(_,i)=>`${id}-${i}`)});
  const playlists=[make('p4',4),make('p20',20)];
  const tracks={},library=[];
  for(const playlist of playlists)for(const item of playlist.items){
    tracks[item]={title:item,artist:'Artist',album:'Album',persistentId:item};
    library.push({id:item,apple_pid:item,title:item,artist:'Artist',album:'Album',in_library:1,plays:31,last_played:new Date().toISOString(),duration_s:180});
  }
  const rows=buildPlaylistRankRows({exportedAt:null,folders:['00_COLLECTION'],playlists,tracks},library,10);
  const four=rows.find(row=>row.id==='p4'),twenty=rows.find(row=>row.id==='p20');
  assert.ok(four&&twenty);
  assert.ok(Math.abs(four.score-31*Math.sqrt(4/20))<1e-9);
  assert.ok(Math.abs(twenty.score-31)<1e-9);
  assert.match(four.explanation,/recency\^1,5/);
  assert.match(four.explanation,/không nhân vào điểm/);
});

test('15-day playlist ranking aggregates listened library tracks and ignores duplicate playlist items',()=>{
  const snapshot={exportedAt:null,folders:['00_COLLECTION'],playlists:[
    {id:'p1',name:'First',folder:'00_COLLECTION',path:'00_COLLECTION',items:['a','a','b']},
    {id:'p2',name:'Second',folder:'00_COLLECTION',path:'00_COLLECTION',items:['c']},
  ],tracks:{
    a:{title:'A',artist:'Artist',album:'Album',persistentId:'PIDA'},
    b:{title:'B',artist:'Artist',album:'Album',persistentId:'PIDB'},
    c:{title:'C',artist:'Artist',album:'Album',persistentId:'PIDC'},
  }};
  const library=[
    {id:'TRA',apple_pid:'PIDA',title:'A',artist:'Artist',album:'Album',in_library:1,plays:4,duration_s:180},
    {id:'TRB',apple_pid:'PIDB',title:'B',artist:'Artist',album:'Album',in_library:1,plays:2,duration_s:240},
    {id:'TRC',apple_pid:'PIDC',title:'C',artist:'Artist',album:'Album',in_library:1,plays:3,duration_s:300},
  ];
  const rows=buildPlaylistPeriodRows(snapshot,library,[{track_id:'TRA',plays:4},{track_id:'TRB',plays:2},{track_id:'TRC',plays:3}],10);
  assert.deepEqual(rows.map(row=>[row.id,row.rank,row.v,row.trackCount]),[['p1',1,'6x',2],['p2',2,'3x',1]]);
  assert.deepEqual(rows[0].metadata.slice(0,5).map(item=>item.title),['Level ranking','Điểm ranking','Recency ranking','Số bài','Play Average']);
  assert.equal(rows[0].metadata[0].text,'L0');
  assert.equal(rows[0].metadata[4].text,'3,3x');
});

test('playlist detail keeps its last snapshot and uses the newest Stats or Apple Music last played value',()=>{
  assert.equal(peekPlaylistSnapshot(),null);
  assert.match(playlistScreen,/useState<PlaylistSnapshot\|null>\(\(\)=>peekPlaylistSnapshot\(\)\)/);
  assert.match(playlistScreen,/\[owned\.last_played,nativeLibraryPlayedAt\][\s\S]*\.sort\(\(a,b\)=>toMs\(b\)-toMs\(a\)\)\[0\]/);
  assert.match(vmSource,/if \(scr === "playlist"\) pull\("recent", "\/recent\?limit=200", true\)/);
  assert.doesNotMatch(playlistScreen,/recentPlayStarts\?\.\[persistentId\]/);
  assert.match(playlistScreen,/shortcut-heading shortcut-heading-link/);
  assert.match(playlistScreen,/c\.go\('playlist',playlist\.id\)/);
});

test('playlist snapshots reject empty or incomplete responses before replacing good data',()=>{
  const valid={exportedAt:'2026-10-22T00:00:00Z',folders:['Folder'],playlists:[{id:'p1',name:'Playlist',folder:'Folder',path:'Folder',items:['t1']}],tracks:{t1:{title:'Song'}}};
  assert.equal(usablePlaylistSnapshot(valid),true);
  assert.equal(usablePlaylistSnapshot({...valid,playlists:[]}),false);
  assert.equal(usablePlaylistSnapshot({...valid,tracks:{}}),false);
  assert.equal(usablePlaylistSnapshot({...valid,playlists:[{...valid.playlists[0],items:['missing']}]}),false);
  assert.match(playlistScreen,/playlist\?\.items\.flatMap\(\(id,index\)=>data\?\.tracks\[id\]\?/);
  assert.match(playlistScreen,/history\/song-ranks\?ids=/);
  assert.match(playlistScreen,/sort\(\)\.slice\(0,80\)/);
  assert.match(playlistScreen,/!!vm\.playlistLibrary&&rows\.some\(\(\{track\}\)=>!findTrack\(track\)&&!track\.missing\)/);
});
