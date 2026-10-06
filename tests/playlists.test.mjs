import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/lib/playlists.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':'./src'}});
const {playlistLibraryIndex,playlistMetricMode,sortPlaylistRows}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
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

test('playlist sorting preserves duplicates, source order and puts missing years last',()=>{
  const rows=[{index:0,track:{title:'Z',year:2001}},{index:1,track:{title:'A',year:2024}},{index:2,track:{title:'A'}},{index:3,track:{title:'A',year:2024}}];
  assert.deepEqual(sortPlaylistRows(rows,'Tên bài').map(x=>x.index),[1,2,3,0]);
  assert.deepEqual(sortPlaylistRows(rows,'Năm mới nhất').map(x=>x.index),[1,3,0,2]);
  assert.deepEqual(sortPlaylistRows(rows,'Thứ tự gốc').map(x=>x.index),[0,1,2,3]);
  assert.deepEqual(rows.map(x=>x.index),[0,1,2,3]);
});
