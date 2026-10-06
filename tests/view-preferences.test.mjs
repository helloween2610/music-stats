import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/view-preferences.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('each screen and playlist restores its own controls without leaking shared state',()=>{
  let ui={views:{},sort:'Điểm',scope:'Năm',q:'leaked',tab:2};
  ui.views=m.rememberView(ui.views,'/overview',{scope:'All time',sel:{monthly:3}});
  ui.views=m.rememberView(ui.views,'/artists',{sort:'Lượt',artistFilter:'Đang lên'});
  ui.views=m.rememberView(ui.views,'/playlist/one',{playlistSort:'Nghệ sĩ',q:'In Flames'});
  assert.equal(m.screenView(ui,'/overview').scope,'All time');
  assert.equal(m.screenView(ui,'/overview').sort,'Giờ nghe');
  assert.deepEqual(m.screenView(ui,'/overview').sel,{monthly:3});
  assert.equal(m.screenView(ui,'/artists').sort,'Lượt');
  assert.equal(m.screenView(ui,'/playlist/one').q,'In Flames');
  assert.equal(m.screenView(ui,'/playlist/two').q,'');
  assert.equal(m.screenView(ui,'/playlists/favourites').playlistFolder,'Favourite');
  assert.equal(m.screenView(ui,'/overview').tab,2);
});
test('storage survives a new read, excludes transient actions and tolerates malformed or blocked storage',()=>{
  let data='';globalThis.localStorage={getItem:()=>data,setItem:(_,value)=>{data=value;}};
  const views=m.rememberView({},'/overview',{scope:'All time',toast:'private',sheet:true,lfmBusy:true});
  m.saveViews(views);assert.deepEqual(m.readViews(),{'/overview':{scope:'All time'}});
  data='{"/overview":{"scope":"Từ 04/2024","sort":"invalid","listLimit":null}}';
  assert.equal(m.screenView({views:m.readViews()},'/overview').scope,'Tháng');
  data='broken';assert.deepEqual(m.readViews(),{});
  globalThis.localStorage={getItem:()=>{throw Error();},setItem:()=>{throw Error();}};
  assert.deepEqual(m.readViews(),{});assert.doesNotThrow(()=>m.saveViews(views));
});
