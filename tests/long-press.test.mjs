import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/lib/long-press.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {longPress}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(t){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  let opened=0;
  return {gesture:longPress(()=>opened++),count:()=>opened,tick:ms=>t.mock.timers.tick(ms)};
}
test('ordinary tap never opens shortcuts and its click is preserved',t=>{
  const {gesture:g,count,tick}=fixture(t);g.start(0,0);tick(100);g.end();tick(600);
  assert.equal(count(),0);assert.equal(g.consumeClick(),false);
});
test('holding opens once after 500 ms and consumes only the release click',t=>{
  const {gesture:g,count,tick}=fixture(t);g.start(0,0);tick(499);assert.equal(count(),0);tick(1);assert.equal(count(),1);
  tick(5000);g.end();assert.equal(g.consumeClick(),true);assert.equal(g.consumeClick(),false);assert.equal(count(),1);
});
test('scrolling and cancellation never open shortcuts',t=>{
  const {gesture:g,count,tick}=fixture(t);g.start(0,0);tick(200);g.move(0,11);tick(600);assert.equal(count(),0);
  g.start(0,0);g.cancel();tick(600);assert.equal(count(),0);
});
test('small touch jitter is allowed, and a fresh tap clears stale suppression',t=>{
  const {gesture:g,count,tick}=fixture(t);g.start(0,0);g.move(3,4);tick(500);assert.equal(count(),1);g.end();
  g.start(0,0);tick(50);g.end();assert.equal(g.consumeClick(),false);
});
test('context menu cancels pending hold and blocks its click without opening twice',t=>{
  const {gesture:g,count,tick}=fixture(t);g.start(0,0);tick(300);g.blockClick();tick(300);assert.equal(count(),0);assert.equal(g.consumeClick(),true);
});
