import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export {BackGesture} from './src/lib/swipe-back'; export {PullGesture} from './src/lib/pull-refresh';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {BackGesture,PullGesture}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('right swipe triggers once; short swipes, reversal and cancellation do not navigate',()=>{
  const g=new BackGesture();
  g.begin(20,100);g.move(99,105);assert.equal(g.end(),false);
  g.begin(20,100);g.move(100,105);assert.equal(g.end(),true);assert.equal(g.end(),false);
  g.begin(20,100);g.move(130,100);g.move(40,100);assert.equal(g.end(),false);
  g.begin(20,100);g.move(130,100);g.cancel();assert.equal(g.end(),false);
});
test('left swipes and vertical/diagonal scrolling cannot become back gestures',()=>{
  for(const [x,y] of [[0,100],[22,130],[40,130],[20,70]]) {
    const g=new BackGesture();g.begin(20,100);g.move(x,y);g.move(150,100);
    assert.equal(g.end(),false);
  }
  const g=new BackGesture();g.begin(20,100);g.move(50,100);g.move(100,200);
  assert.equal(g.end(),false);
});
test('pull to refresh and swipe back are mutually exclusive',()=>{
  for(const [points,expectedBack,expectedRefresh] of [
    [[[25,102],[70,105],[140,110]],true,false],
    [[[22,108],[23,140],[25,240]],false,true],
  ]) {
    const back=new BackGesture(),pull=new PullGesture();
    back.begin(20,100);pull.begin(20,100,true);
    for(const [x,y] of points){back.move(x,y);pull.move(x,y);}
    assert.equal(back.end(),expectedBack);assert.equal(pull.end(),expectedRefresh);
  }
});
