import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('opt-in device probe records frame timing locally without song metadata',()=>{
  const source=readFileSync(new URL('../ios/diagnostics/menu-motion.js',import.meta.url),'utf8');
  let now=0, observer, raf;
  const events={}, timers=new Map(), writes=[];
  const sheet={isConnected:true,getBoundingClientRect:()=>({y:844-now/3,height:640})};
  const backdrop={nodeType:1,matches:()=>true,querySelector:()=>sheet,querySelectorAll:()=>[]};
  const document={body:{},visibilityState:'visible',getElementsByTagName:()=>({length:600}),addEventListener:(name,fn)=>events[name]=fn};
  runInNewContext(source,{
    document,navigator:{userAgent:'iPhone test'},innerWidth:390,innerHeight:844,devicePixelRatio:3,
    performance:{now:()=>now},matchMedia:()=>({matches:false}),
    getComputedStyle:()=>({animationName:'sheet-in',animationDuration:'0.46s',animationTimingFunction:'ease'}),
    requestAnimationFrame:fn=>raf=fn,
    setTimeout:fn=>{timers.set(fn,fn);return fn;},clearTimeout:id=>timers.delete(id),
    MutationObserver:class {constructor(fn){observer=fn;}observe(){}},
    window:{Capacitor:{Plugins:{Filesystem:{writeFile:args=>{writes.push(args);return Promise.resolve();}}}}}
  });
  events.click({target:{closest:()=>({textContent:'Private track title'})}});
  now=300;observer([{addedNodes:[backdrop]}]);
  for(now=316;now<=2132;now+=16)raf(now);
  [...timers.values()].forEach(fn=>fn());
  assert.equal(writes.length,1);
  assert.equal(writes[0].directory,'DOCUMENTS');
  const report=JSON.parse(writes[0].data).reports[0];
  assert.equal(report.input.mountDelay,300);
  assert.equal(report.animation[1],'0.46s');
  assert.ok(report.frames.length>100);
  assert.ok(!writes[0].data.includes('Private track title'));
});
