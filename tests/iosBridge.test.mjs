import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const calls=[];
const nativeCalls=[];
let nativeFailure=null;
let nativeStatus=200;
globalThis.statsMusicRequest=async options=>{
  nativeCalls.push(options);
  calls.push('http://native-test'+options.path+'?'+new URLSearchParams(options.params));
  if(nativeFailure)throw nativeFailure;
  const data=options.path==='/tracks'?[
    {id:'1',persistentID:'00000000000000AA',title:'Stand Ablaze',subtitle:'In Flames',year:'1994',lastPlayed:'2026-10-22T04:10'},
    {id:'2',persistentID:'00000000000000BB',title:'Never Played',subtitle:'In Flames',year:'1994'},
  ]:nativeStatus===200?{ok:true}:{error:'Không đổi được thứ tự hàng chờ.'};
  return {status:nativeStatus,body:JSON.stringify(data)};
};
let failures=0;
globalThis.fetch=async url=>{
  calls.push(String(url));
  if(failures>0){failures-=1;throw new Error('bridge starting');}
  if(String(url).includes('/tracks?'))return {ok:true,json:async()=>[
    {id:'1',persistentID:'00000000000000AA',title:'Stand Ablaze',subtitle:'In Flames',year:'1994',lastPlayed:'2026-10-22T04:10'},
    {id:'2',persistentID:'00000000000000BB',title:'Never Played',subtitle:'In Flames',year:'1994'},
  ]};
  return {ok:true,json:async()=>({ok:true})};
};
const compiled=await build({
  entryPoints:['src/lib/ios-bridge.ts'],
  bundle:true,
  write:false,
  format:'esm',
  platform:'node',
  alias:{'@':'./src'},
  plugins:[{name:'native-music-fixture',setup(build){
    build.onResolve({filter:/^@capacitor\/core$/},()=>({path:'core',namespace:'native-fixture'}));
    build.onLoad({filter:/.*/,namespace:'native-fixture'},()=>({contents:`
      export const registerPlugin=name=>name==='StatsMusic'?{request:options=>globalThis.statsMusicRequest(options)}:{};
    `}));
  }}],
  define:{
    'import.meta.env':'{}',
    'import.meta.env.VITE_IOS_APP':'"true"',
    'import.meta.env.VITE_BROWSER_PREVIEW':'"false"',
  },
});
const app=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('whole-playlist actions use the native queue route',async()=>{
  assert.equal(await app.playPlaylistInNativeApp('799E5845AB5F2C63','play'),true);
  assert.equal(await app.playPlaylistInNativeApp('799E5845AB5F2C63','next'),true);
  assert.deepEqual(calls.map(value=>{
    const url=new URL(value);
    return [url.pathname,url.searchParams.get('playlist'),url.searchParams.get('action')];
  }),[
    ['/play','799E5845AB5F2C63','play'],
    ['/play','799E5845AB5F2C63','next'],
  ]);
});

test('whole-album actions use the native queue route',async()=>{
  calls.length=0;
  assert.equal(await app.playAlbumInNativeApp('In Flames','Whoracle','play'),true);
  assert.equal(await app.playAlbumInNativeApp('In Flames','Whoracle','next'),true);
  assert.deepEqual(calls.map(value=>{
    const url=new URL(value);
    return [url.pathname,url.searchParams.get('artist'),url.searchParams.get('album'),url.searchParams.get('action')];
  }),[
    ['/album-action','In Flames','Whoracle','play'],
    ['/album-action','In Flames','Whoracle','next'],
  ]);
});

test('queue-from-here actions include the selected track',async()=>{
  calls.length=0;
  const start={persistentId:'5D66052979B6450A',artist:'Aephanemer',title:"Sisyphus' Bliss"};
  assert.equal(await app.playPlaylistInNativeApp('799E5845AB5F2C63','play',start),true);
  assert.equal(await app.playAlbumInNativeApp('Aephanemer','Memento Mori','play',start),true);
  assert.deepEqual(calls.map(value=>{
    const url=new URL(value);
    return [url.pathname,url.searchParams.get('track'),url.searchParams.get('title'),url.searchParams.get('action')];
  }),[
    ['/play','5D66052979B6450A',"Sisyphus' Bliss",'play'],
    ['/album-action','5D66052979B6450A',"Sisyphus' Bliss",'play'],
  ]);
});

test('section queue keeps the selected row and the rows below it',async()=>{
  calls.length=0;
  assert.equal(await app.playSectionFromHereInNativeApp([
    {persistentId:'AA',title:'Before'},
    {persistentId:'BB',title:'Selected'},
    {persistentId:'',title:'Unavailable'},
    {persistentId:'CC',title:'After'},
  ],1),true);
  const url=new URL(calls[0]);
  assert.equal(url.pathname,'/queue-action');
  assert.equal(url.searchParams.get('ids'),'BB,CC');
});

test('player and queue controls use the native player routes',async()=>{
  calls.length=0;
  nativeCalls.length=0;
  await app.controlNativePlayer('playpause');
  await app.seekNativePlayer(83);
  await app.playNativeQueueItem(4);
  await app.moveNativeQueueItem(4,2);
  await app.removeNativeQueueItem(3);
  assert.deepEqual(calls.map(value=>{
    const url=new URL(value);
    return [url.pathname,Object.fromEntries(url.searchParams)];
  }),[
    ['/control',{action:'playpause'}],
    ['/seek',{position:'83'}],
    ['/queue-play',{index:'4'}],
    ['/queue-move',{from:'4',to:'2'}],
    ['/queue-remove',{index:'3'}],
  ]);
  assert.equal(nativeCalls.length,5);
});

test('native command failures are shown without replaying mutations over HTTP',async()=>{
  calls.length=0;
  nativeCalls.length=0;
  nativeFailure=new Error('Native unavailable');
  try {await assert.rejects(app.controlNativePlayer('playpause'),/Native unavailable/);}
  finally {nativeFailure=null;}
  assert.equal(nativeCalls.length,1);
  assert.equal(calls.length,1);
  nativeStatus=400;
  try {await assert.rejects(app.moveNativeQueueItem(2,1),/Không đổi được thứ tự/);}
  finally {nativeStatus=200;}
});

test('native artwork URL addresses the local bridge',()=>{
  assert.equal(app.nativePlayerArtworkUrl('5D66052979B6450A'),'http://127.0.0.1:8765/artwork?pid=5D66052979B6450A');
});

test('elapsed-time polling opts out of queue enumeration; explicit refresh includes it',async()=>{
  calls.length=0;
  await app.loadNativePlayerState(false);
  await app.loadNativePlayerState();
  assert.deepEqual(calls.map(value=>new URL(value).searchParams.get('queue')),['0','1']);
});

test('playlist last-played metadata comes from the live native library',async()=>{
  calls.length=0;
  assert.deepEqual(await app.loadNativePlaylistLastPlayedInNativeApp('799E5845AB5F2C63'),{
    '00000000000000AA':'2026-10-22T04:10',
  });
  const url=new URL(calls[0]);
  assert.equal(url.pathname,'/tracks');
  assert.equal(url.searchParams.get('playlist'),'799E5845AB5F2C63');
});

test('widget playlist publishing retries while the native bridge starts',async()=>{
  calls.length=0;
  failures=1;
  const playlists=Array.from({length:5},(_,index)=>({
    id:String(index+1),name:`Playlist ${index+1}`,path:'Folder',rank:index+1,
    plays:20-index,trackCount:10+index,hue:index*40,
  }));
  assert.equal(await app.publishWidgetTopPlaylistsInNativeApp(playlists),true);
  assert.equal(calls.length,2);
  const url=new URL(calls.at(-1));
  assert.equal(url.pathname,'/widget-playlists');
  assert.equal(JSON.parse(url.searchParams.get('payload')).length,4);
});
