import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:"export * from './src/lib/api';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
let instance=0;
const data=new Map();
async function load(){globalThis.window={localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}};return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text+'\n//'+instance++).toString('base64'));}
const flush=()=>new Promise(r=>setImmediate(r));
test('same generation survives invalidation and reopen without network; new generation fetches',async()=>{
 let calls=0;globalThis.fetch=async url=>{calls++;const generation=new URL(url).searchParams.get('generation');return new Response(JSON.stringify({generation,rows:[{id:'TR1',title:generation}]}));};
 let api=await load();const path='/library/metadata?offset=0&limit=1000&generation=1';api.fetchJson(path,true);await flush();assert.equal(calls,1);
 api.invalidate(()=>true);assert.equal(api.fetchJson(path,true).data.rows[0].title,'1');await flush();assert.equal(calls,1);
 api=await load();assert.equal(api.fetchJson(path,true).data.rows[0].title,'1');await flush();assert.equal(calls,1);
 const next=api.fetchJson(path.replace('generation=1','generation=2'),true);await flush();assert.equal(calls,2);assert.equal(next.data.rows[0].title,'2');
});
