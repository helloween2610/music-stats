import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result=await build({
  stdin:{contents:`export {charts} from './src/vm'; export {BASE} from './src/state'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:process.cwd(),loader:'ts'},
  bundle:true,write:false,format:'esm',platform:'browser',
  define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
});
globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{}}};
const app=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));

test('Today charts stay on today and the listening clock has no selectable hours',()=>{
  let changed=false;
  const c={p:{...app.BASE,sel:{week:6,weekHour:22}},screen:'today',id:null,set:()=>{changed=true;}};
  const days=['T2','T3','T4','T5','T6','T7','CN'].map((l,i)=>({l,full:'Ngày '+i,v:[i+1,i+2,i+3]}));
  const vm=app.charts(c,null,null,{week:{def:2,days},weekHours:Array.from({length:24},(_,i)=>i)});
  assert.match(vm.rd.week,/^Ngày 2:/);
  const week=app.renderToStaticMarkup(vm.ch.week);
  const clock=app.renderToStaticMarkup(vm.ch.weekHour);
  assert.equal(changed,false);
  assert.doesNotMatch(week,/cursor:pointer/);
  assert.doesNotMatch(clock,/role="button"|tabindex=|aria-pressed|cursor:pointer/);
  assert.doesNotMatch(clock,/stroke="var\(--accent\)"/);
});
