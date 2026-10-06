import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/lib/discovery.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'test-config',setup(b){b.onResolve({filter:/^@\/config$/},()=>({path:'config',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const API_BASE="https://example.test", API_TOKEN="test", BROWSER_PREVIEW=false;'}));}}]});
const url='data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64');
const old={id:'11111111-1111-1111-1111-111111111111',artist:'Band',title:'Saved album',date:'2026-10-09',type:'Album',owned:false,url:'https://musicbrainz.org/release-group/11111111-1111-1111-1111-111111111111',cover:'',sources:['MusicBrainz']};
let serial=0;
async function setup(){
 const disk=new Map();
 const legacy=JSON.stringify({'discovery:releases:v6':{at:1,data:{rows:[old],asOf:'2026-10-03',checked:143,total:143,next:null,failed:[],unverified:0}}});
 globalThis.window={localStorage:{getItem:k=>disk.get(k)??(k.endsWith(':discovery')?legacy:null),setItem:(k,v)=>disk.set(k,v)}};
 return {app:await import(url+'#'+serial++),disk};
}
test('saved releases render immediately while one server snapshot refresh merges new albums',async()=>{
 const {app,disk}=await setup();let respond;let calls=0;
 globalThis.fetch=async path=>{calls++;assert.match(String(path),/snapshot=1/);assert.doesNotMatch(String(path),/cursor=/);return new Promise(r=>respond=r);};
 assert.deepEqual(app.releaseSnapshot().rows,[old]);
 const loading=app.openReleases();
 assert.equal(calls,1);assert.equal(app.releaseSnapshot().busy,true);assert.deepEqual(app.releaseSnapshot().rows,[old]);
 await app.openReleases();assert.equal(calls,1); // concurrent mounts share one snapshot request
 const added={...old,id:'22222222-2222-2222-2222-222222222222',title:'New album',url:'https://musicbrainz.org/release-group/22222222-2222-2222-2222-222222222222'};
 respond(Response.json({rows:[added],checked:143,total:143,next:null,asOf:app.vnDate(),unverified:0,scan:{completedAt:'2026-10-05T00:35:00.000Z'}}));await loading;
 assert.deepEqual(app.releaseSnapshot().rows.map(r=>r.id),[old.id,added.id]);
 assert.equal(app.releaseSnapshot().checked,143);assert.equal(app.releaseSnapshot().next,null);
 assert.ok([...disk.keys()].some(k=>k.endsWith(':release-feed')));
 const reopened=await import(url+'#'+serial++);
 assert.equal(reopened.releaseSnapshot().rows.length,2);
});
test('a failed background refresh keeps the saved list',async()=>{
 const {app}=await setup();globalThis.fetch=async()=>Response.json({error:'MusicBrainz unavailable'},{status:503});
 await app.openReleases();assert.deepEqual(app.releaseSnapshot().rows,[old]);assert.ok(app.releaseSnapshot().error);assert.equal(app.releaseSnapshot().busy,false);
});
test('retained releases respect the rolling display windows',async()=>{
 const {app}=await setup();
 assert.equal(app.releaseInWindow('2026-07-06','recent','2026-10-04'),true);
 assert.equal(app.releaseInWindow('2026-07-05','recent','2026-10-04'),false);
 assert.equal(app.releaseInWindow('2026-10-04','recent','2026-10-04'),true);
 assert.equal(app.releaseInWindow('2026-10-09','upcoming','2026-10-04'),true);
 assert.equal(app.releaseInWindow('2027-10-05','upcoming','2026-10-04'),false);
});

test('legacy saved cursors never cause an on-device provider scan',async()=>{
 const {app,disk}=await setup();
 const key=[...disk.keys()].find(k=>k.endsWith(':release-feed'));
 const saved=JSON.parse(disk.get(key));saved['discovery:releases:v6'].data.next='80~0';saved['discovery:releases:v6'].data.checked=80;disk.set(key,JSON.stringify(saved));
 const reopened=await import(url+'#'+serial++);const paths=[];
 globalThis.fetch=async path=>{paths.push(String(path));return Response.json({rows:[],checked:143,total:143,next:null,asOf:app.vnDate(),unverified:0});};
 await reopened.openReleases();
 assert.equal(paths.length,1);assert.ok(paths[0].includes('snapshot=1'));assert.ok(!paths[0].includes('cursor='));
});
test('server releases are restored through the snapshot endpoint',async()=>{
 const {app}=await setup();const added={...old,id:'33333333-3333-3333-3333-333333333333',title:'Server album',url:'https://musicbrainz.org/release-group/33333333-3333-3333-3333-333333333333'};
 globalThis.fetch=async()=>Response.json({rows:[added],checked:143,total:143,next:null,asOf:app.vnDate(),unverified:0});
 await app.openReleases();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(app.releaseSnapshot().rows.map(r=>r.id),[old.id,added.id]);
});
test('the removed v5 Apple feed is not restored into the MusicBrainz release cache',async()=>{
 const apple={id:'itunes:vn:1',artist:'Band',title:'Apple album',date:'2026-10-09',type:'Album',owned:false,url:'https://music.apple.com/vn/album/1',cover:'',sources:['Apple Music']};
 const legacy=JSON.stringify({'discovery:releases:v5':{at:1,data:{rows:[apple],asOf:'2026-10-03',checked:143,total:143,next:null,failed:[],unverified:0}}});
 globalThis.window={localStorage:{getItem:k=>k.endsWith(':discovery')?legacy:null,setItem:()=>{}}};
 const app=await import(url+'#'+serial++);
 assert.deepEqual(app.releaseSnapshot().rows,[]);
});
