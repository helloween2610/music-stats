import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const output=await build({entryPoints:['src/lib/discovery.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':'./src'},define:{'import.meta.env':'{}'}});
const memory=new Map();globalThis.window={localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}};
const {loadLastfmTrack}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('playlist counters cache duplicate requests, retain zeros and skip cancelled queued rows',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({status:'found',scrobbles:123,listeners:0,updatedAt:new Date().toISOString()});};
  try {
    const signal=new AbortController().signal,q={artist:'Band',title:'Song'};
    const [a,b]=await Promise.all([loadLastfmTrack(q,signal),loadLastfmTrack(q,signal)]);
    assert.deepEqual(a,b);assert.equal(a.listeners,0);assert.equal(calls,1);
    const cancelled=new AbortController();cancelled.abort();
    await assert.rejects(loadLastfmTrack({artist:'Band',title:'Cancelled'},cancelled.signal),e=>e.name==='AbortError');
    assert.equal(calls,1);
    globalThis.fetch=async url=>{calls++;assert.ok(String(url).endsWith('/lastfm/TR123'));return Response.json({status:'not_found',updatedAt:new Date().toISOString()});};
    const missing=await loadLastfmTrack({...q,trackId:'TR123'},signal);
    assert.equal(missing.scrobbles,undefined);assert.equal(missing.status,'not_found');assert.equal(calls,2);
  } finally {globalThis.fetch=original;}
});
