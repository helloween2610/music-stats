import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/pull-refresh.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {PullGesture}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('only a sufficiently long downward pull beginning at scroll top refreshes',()=>{
  const g=new PullGesture();
  g.begin(20,100,true);assert.equal(g.move(22,218),59);assert.equal(g.end(),false);
  g.begin(20,100,true);assert.equal(g.move(22,220),60);assert.equal(g.end(),true);assert.equal(g.end(),false);
  g.begin(20,100,false);g.move(20,500);assert.equal(g.end(),false);
  g.begin(20,100,true);g.move(20,90);g.move(20,400);assert.equal(g.end(),false);
});
test('horizontal swipes, canceled gestures and pulling back never refresh',()=>{
  const g=new PullGesture();
  g.begin(20,100,true);g.move(100,110);g.move(100,500);assert.equal(g.end(),false);
  g.begin(20,100,true);g.move(20,240);g.cancel();assert.equal(g.end(),false);
  g.begin(20,100,true);g.move(20,240);g.move(20,130);assert.equal(g.end(),false);
});
