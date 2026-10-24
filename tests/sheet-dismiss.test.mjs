import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

const compiled=await build({stdin:{contents:"export * from './src/components/shortcut-sheet-controls'; export * from './src/components/view-motion';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',jsx:'transform',define:{'import.meta.env':'{}'},plugins:[{
  name:'hook-refs',setup(build){
    build.onResolve({filter:/^react(?:\/jsx-runtime)?$/},()=>({path:'react',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
      export const useRef = current => ({current});
      export const useCallback = fn => fn;
      export const useEffect = fn => { (globalThis.motionCleanups ||= []).push(fn()); };
      export const useState = value => [value, next => globalThis.motionStates.push(next)];
      export const jsx = () => null;
      export const jsxs = jsx;
      export const Fragment = "fragment";
    `}));
  },
}]});
const {useSheetSwipeDismiss,useSheetMotion,useMenuLinkTap,viewMotionKey}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(scrollTop=0){
  let closed=0;
  const handlers=useSheetSwipeDismiss(()=>closed++);
  const point=(x,y)=>({clientX:x,clientY:y});
  return {handlers,count:()=>closed,
    start:()=>handlers.onTouchStartCapture({currentTarget:{scrollTop},touches:[point(0,0)]}),
    move:(x,y)=>handlers.onTouchMoveCapture({touches:[point(x,y)]}),
    end:(x,y)=>handlers.onTouchEndCapture({changedTouches:[point(x,y)]}),
  };
}
test('downward swipe closes once and suppresses its release click',()=>{
  const f=fixture();f.start();f.move(5,90);f.end(5,90);f.end(5,90);
  assert.equal(f.count(),1);
  let blocked=false;
  f.handlers.onClickCapture({preventDefault(){blocked=true;},stopPropagation(){}});
  assert.equal(blocked,true);
});
test('scrolling content, upward, horizontal and short swipes do not dismiss',()=>{
  for(const [scroll,x,y] of [[20,0,100],[0,0,-100],[0,100,80],[0,0,20]]){
    const f=fixture(scroll);f.start();f.move(x,y);f.end(x,y);assert.equal(f.count(),0);
  }
});
test('cancellation and multitouch abandon dismissal; a fresh tap is preserved',()=>{
  const f=fixture();f.start();f.move(0,90);f.handlers.onTouchCancelCapture();f.end(0,90);
  assert.equal(f.count(),0);
  f.start();f.handlers.onTouchMoveCapture({touches:[{},{}]});f.end(0,90);assert.equal(f.count(),0);
  f.start();f.end(0,0);
  f.handlers.onClickCapture({preventDefault(){assert.fail('tap blocked');},stopPropagation(){}});
});

function motionFixture(t,reduced=false){
  globalThis.motionCleanups=[];
  globalThis.motionStates=[];
  globalThis.window={matchMedia:()=>({matches:reduced})};
  t.after(()=>{
    globalThis.motionCleanups.forEach(fn=>fn?.());
    delete globalThis.motionCleanups;
    delete globalThis.motionStates;
    delete globalThis.window;
  });
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('menu links distinguish a single tap from two touch clicks even when both report detail 1',async t=>{
  motionFixture(t);
  const link=useMenuLinkTap(), calls=[];
  link.tap('artist',1,()=>calls.push('menu'),()=>calls.push('page'));
  assert.deepEqual(calls,[]);
  await wait(330);
  assert.deepEqual(calls,['menu']);
  calls.length=0;
  link.tap('artist',1,()=>calls.push('menu'),()=>calls.push('page'));
  link.tap('artist',1,()=>calls.push('menu'),()=>calls.push('page'));
  assert.deepEqual(calls,['page']);
  await wait(330);
  assert.deepEqual(calls,['page']);
});
test('different menu destinations do not count as a double tap and pending actions can be cancelled',async t=>{
  motionFixture(t);
  const link=useMenuLinkTap(), calls=[];
  link.tap('artist',1,()=>calls.push('artist menu'),()=>calls.push('artist page'));
  link.tap('album',1,()=>calls.push('album menu'),()=>calls.push('album page'));
  await wait(330);
  assert.deepEqual(calls,['album menu']);
  link.tap('playlist:1',1,()=>calls.push('playlist menu'),()=>calls.push('playlist page'));
  link.cancel();
  await wait(330);
  assert.deepEqual(calls,['album menu']);
});
test('keyboard activation opens a menu immediately and unmount cancels a pending tap',async t=>{
  motionFixture(t);
  const link=useMenuLinkTap(), calls=[];
  link.tap('album',0,()=>calls.push('menu'),()=>calls.push('page'));
  assert.deepEqual(calls,['menu']);
  link.tap('album',1,()=>calls.push('menu'),()=>calls.push('page'));
  globalThis.motionCleanups.forEach(fn=>fn?.());
  await wait(330);
  assert.deepEqual(calls,['menu']);
});
test('view motion responds to filters and loading, not player ticks, search typing or chart selections',()=>{
  const view={sort:'Giờ nghe',trendMode:'Tháng',playlistFolder:'Tất cả'};
  const key=viewMotionKey(view,false);
  assert.notEqual(viewMotionKey({...view,sort:'Lượt'},false),key);
  assert.notEqual(viewMotionKey({...view,trendMode:'Năm'},false),key);
  assert.notEqual(viewMotionKey({...view,playlistFolder:'Metal'},false),key);
  assert.notEqual(viewMotionKey(view,true),key);
  assert.equal(viewMotionKey({...view,ptoast:'Updated',q:'abc',sel:{month:3},tab:2},false),key);
});
test('menu remains mounted during exit and repeated close fires only once',async t=>{
  motionFixture(t);
  let closed=0;
  const motion=useSheetMotion(()=>closed++);
  motion.close();motion.close();
  assert.equal(closed,0);
  assert.deepEqual(globalThis.motionStates,['slide',true]);
  let blocked=false;
  motion.motionProps.onClickCapture({preventDefault(){blocked=true;},stopPropagation(){}});
  assert.equal(blocked,true);
  await wait(220);
  assert.equal(closed,1);
});
test('unmount cancels a pending navigation after exit',async t=>{
  motionFixture(t);
  let navigated=false;
  useSheetMotion(()=>{}).exit(()=>{navigated=true;});
  globalThis.motionCleanups.forEach(fn=>fn?.());
  await wait(220);
  assert.equal(navigated,false);
});
test('reduced motion closes without waiting for the slide',async t=>{
  motionFixture(t,true);
  let closed=false;
  useSheetMotion(()=>{closed=true;}).close();
  await wait(10);
  assert.equal(closed,true);
});
test('menu defers data work until its entrance completes',t=>{
  motionFixture(t);
  const motion=useSheetMotion(()=>{});
  assert.equal(motion.ready,false);
  motion.motionProps.onAnimationEnd({animationName:'sheet-backdrop-in'});
  assert.deepEqual(globalThis.motionStates,[]);
  motion.motionProps.onAnimationEnd({animationName:'sheet-in'});
  assert.deepEqual(globalThis.motionStates,[true]);
});
test('closing during entrance does not activate deferred work',t=>{
  motionFixture(t);
  const motion=useSheetMotion(()=>{});
  motion.close();
  motion.motionProps.onAnimationEnd({animationName:'sheet-in'});
  assert.deepEqual(globalThis.motionStates,['slide',true]);
});

test('switching menus fades without invoking slide exit and waits for fade completion',async t=>{
  motionFixture(t);
  const motion=useSheetMotion(()=>{},'fade');
  assert.equal(motion.motionProps['data-entry'],'fade');
  motion.motionProps.onAnimationEnd({animationName:'sheet-crossfade-in'});
  assert.deepEqual(globalThis.motionStates,[true]);
  let switched=false;
  motion.exit(()=>{switched=true;},'fade');
  assert.deepEqual(globalThis.motionStates,[true,'fade',true]);
  assert.equal(switched,false);
  await wait(110);
  assert.equal(switched,true);
});

test('menu fades animate content only, keeping the shell opaque and dismissal separate',()=>{
  const css=readFileSync('src/css/app.scss','utf8');
  assert.match(css,/\[data-entry="fade"\]:not\(\[data-closing\]\) > \.shortcut-sheet,\s*\.shortcut-backdrop\[data-closing\]\[data-exit="fade"\] > \.shortcut-sheet \{ animation:none!important; \}/);
  assert.match(css,/\.shortcut-sheet > :not\(\.shortcut-sheet-nav\) \{ animation:sheet-crossfade-in 120ms/);
  assert.match(css,/\.shortcut-sheet > :not\(\.shortcut-sheet-nav\) \{ animation:sheet-crossfade-out 80ms/);
  assert.doesNotMatch(css,/> \.shortcut-sheet \{ animation:sheet-crossfade/);
});
