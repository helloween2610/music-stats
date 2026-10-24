import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result=await build({stdin:{contents:"export * from './src/lib/api-read-scope'; export * from './src/lib/sheet-gesture'; export * from './src/lib/view-model-input'; export {sameResponseReferences} from './src/lib/last-good';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {collectApiReads,recordApiRead,affectsApiReads,SheetGesture,sameResponseReferences,sameViewModelInput}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('navigation chrome does not rebuild the model; filters, charts and selections do',()=>{
  const p={scope:'Tháng',sort:'Giờ nghe',sel:{},views:{},pageParents:{},tab:0,ptoast:''};
  assert.equal(sameViewModelInput(p,{...p,views:{'/artist/1':{}},pageParents:{a:1},tab:2,ptoast:'Done'}),true);
  for(const change of [{scope:'Năm'},{sort:'Lượt'},{sel:{month:2}},{rankFocus:{key:'1'}},{periodListSize:100}]){
    assert.equal(sameViewModelInput(p,{...p,...change}),false);
  }
});
test('unchanged cached responses do not serialize the full library during navigation',()=>{
  const data={toJSON(){assert.fail('must not serialize');}};
  assert.equal(sameResponseReferences({library:data,rank:3},{rank:3,library:data}),true);
  assert.equal(sameResponseReferences({library:data},{library:{}}),false);
  assert.equal(sameResponseReferences({library:data},{library:data,rank:3}),false);
  assert.equal(sameResponseReferences(undefined,{library:data}),false);
  assert.equal(sameResponseReferences({a:undefined},{b:undefined}),false);
});
test('views ignore unrelated request completions but retain global invalidation',()=>{
  const view=collectApiReads(()=>{recordApiRead('/summary');recordApiRead('/daily');return 42;});
  assert.equal(view.value,42);
  assert.equal(affectsApiReads(view.paths,'/song/42'),false);
  assert.equal(affectsApiReads(view.paths,'/summary'),true);
  assert.equal(affectsApiReads(view.paths),true);
  assert.equal(affectsApiReads(undefined,'/song/42'),true);
});
test('nested read scopes preserve dependencies and throwing scopes do not leak',()=>{
  const outer=collectApiReads(()=>{recordApiRead('/summary');collectApiReads(()=>recordApiRead('/daily'));});
  assert.deepEqual([...outer.paths],['/summary','/daily']);
  assert.throws(()=>collectApiReads(()=>{recordApiRead('/error');throw Error('test');}));
  const next=collectApiReads(()=>recordApiRead('/artist/1'));
  assert.deepEqual([...next.paths],['/artist/1']);
});
test('sheet follows a downward drag and cancels a short slow pull',()=>{
  const g=new SheetGesture();g.begin(0,0,0);
  assert.equal(g.move(1,4,20),false);
  assert.equal(g.move(2,30,200),true);
  assert.equal(g.offset,30);
  assert.equal(g.end(700,300),false);
});
test('sheet dismisses a long pull or quick flick, not a paused short pull',()=>{
  const g=new SheetGesture();g.begin(0,0,0);g.move(1,140,500);
  assert.equal(g.end(700,510),true);
  g.begin(0,0,0);g.move(0,35,40);g.move(0,35,50);
  assert.equal(g.end(700,60),true);
  g.begin(0,0,0);g.move(0,35,40);
  assert.equal(g.end(700,300),false);
});
test('horizontal or upward scrolling never converts to a sheet dismissal',()=>{
  for(const [x,y] of [[50,20],[0,-20]]){
    const g=new SheetGesture();g.begin(0,0,0);
    assert.equal(g.move(x,y,100),false);
    assert.equal(g.move(0,200,200),false);
    assert.equal(g.end(700,210),false);
  }
});
