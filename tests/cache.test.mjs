import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: `export * from './src/lib/api'; export * from './src/lib/last-good'; export { buildVM } from './src/vm'; export { BASE } from './src/state';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
let version = 0;
const memoryStorage = () => {
  const items = new Map();
  return { getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
};
async function load(storage = memoryStorage()) {
  globalThis.window = { localStorage: storage };
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text + `\n// instance ${version++}`).toString('base64'));
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const rows = { rows: [{ title: 'Actual server song', plays: 29 }] };

test('last server response survives network failures, invalidation and a new app session', async () => {
  const storage = memoryStorage();
  let api = await load(storage);
  globalThis.fetch = async () => reply(rows);
  const initial = api.fetchJson('/recent?limit=5');
  api.fetchJson('/recent?limit=5');
  await flush();
  assert.equal(initial.st, 'ok');
  const savedAt = initial.dataAt;
  api.invalidate(() => true);
  globalThis.fetch = async () => { throw Error('offline'); };
  const failed = api.fetchJson('/recent?limit=5');
  assert.deepEqual(failed.data, rows); // visible even while revalidating
  await flush();
  assert.equal(failed.st, 'err');
  assert.equal(failed.dataAt, savedAt);
  api = await load(storage);
  const restored = api.fetchJson('/recent?limit=5');
  await flush();
  assert.deepEqual(restored.data, rows);
  assert.equal(restored.st, 'err');
  const missing = api.fetchJson('/recent?limit=50');
  await flush();
  assert.equal(missing.data, null); // do not reuse another query
});

test('503, 401 and malformed responses preserve the good value; a valid empty result replaces it', async () => {
  const api = await load();
  globalThis.fetch = async () => reply(rows);
  api.fetchJson('/recent'); await flush();
  for (const [body, status] of [[{error:'d1_daily_limit'},503], [{error:'unauthorized'},401], [{},200], [null,200]]) {
    api.invalidate(() => true);
    globalThis.fetch = async () => reply(body,status);
    const entry = api.fetchJson('/recent'); await flush();
    assert.equal(entry.st,'err'); assert.deepEqual(entry.data,rows);
  }
  api.invalidate(() => true);
  globalThis.fetch = async () => reply({rows:[]});
  const empty = api.fetchJson('/recent'); await flush();
  assert.equal(empty.st,'ok'); assert.deepEqual(empty.data,{rows:[]});
});

test('invalidated in-flight requests cannot overwrite a more recent success', async () => {
  const api = await load();
  let finishOld;
  globalThis.fetch = () => new Promise(resolve => { finishOld = resolve; });
  api.fetchJson('/recent');
  api.invalidate(() => true);
  globalThis.fetch = async () => reply(rows);
  api.fetchJson('/recent'); await flush();
  finishOld(reply({rows:[{title:'old'}]})); await flush();
  assert.deepEqual(api.lastGood.get('/recent').data,rows);
});

test('unavailable storage does not break memory fallback; cache namespace and size are bounded', async () => {
  const api = await load();
  const blocked = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  const store = new api.LastGoodStore('test',blocked);
  store.set('/recent',rows,100);
  assert.deepEqual(store.get('/recent').data,rows);
  assert.notEqual(api.cacheScope('server','a'),api.cacheScope('server','b'));
  assert.notEqual(api.cacheScope('server','a'),api.cacheScope('other','a'));
  const storage = memoryStorage();
  const small = new api.LastGoodStore('bounded',storage,200);
  small.set('old',{text:'a'.repeat(80)},1);
  small.set('new',{text:'b'.repeat(80)},2);
  assert.ok(storage.getItem('bounded').length <= 200);
  assert.ok(new api.LastGoodStore('bounded',storage).get('new'));
  const corrupt = new api.LastGoodStore('bad',{getItem:()=>'{bad',setItem:()=>{}});
  assert.equal(corrupt.get('/recent'),undefined);
});

test('server view never displays samples on first-load failure; saved view survives reload and still updates', async () => {
  const storage = memoryStorage();
  let api = await load(storage);
  const ctx = () => ({p:{...api.BASE},screen:'today',id:null,set:()=>{},go:()=>{},goTab:()=>{},swap:()=>{},later:()=>{},ptoast:()=>{}});
  globalThis.fetch = async () => reply({error:'down'},503);
  assert.equal(api.buildVM(ctx()).isLoading,true);
  await flush();
  assert.ok(api.buildVM(ctx()).unavailable);
  const period = {plays:987,tracks:12,artists:4,change:1,from:'2026-09-28',to:'2026-10-04'};
  const payload = {
    '/artwork': {artists:{},tracks:{},albums:{}},
    '/summary': {asOf:'2026-10-02',week:period,month:period,year:period,total:{plays:9876,songs:3000,artists:400}},
    '/overview?scope=week': {totals:{plays:53},months:[],byHour:[{k:22,plays:13}]},
    '/daily': {byHour:[],days:[{date:'2026-10-02',plays:20,lastWeek:10,record:30}]},
    '/recent?limit=5': {rows:[]}, '/artists/week?limit=5': {rows:[]},
    '/charts/songs?window=month&limit=5': {rows:[{track_id:'TR1',rank:1,title:'Server only title',artist:'Real artist',plays:30}]},
  };
  globalThis.fetch = async url => reply(payload[new URL(url).pathname + new URL(url).search]);
  api.invalidate(()=>true); api.buildVM(ctx()); await flush();
  let vm = api.buildVM(ctx());
  assert.equal(vm.rd.weekHour,'22h–23h · 13 lượt');
  assert.equal(vm.wk.plays,'987'); assert.equal(vm.top5[0].title,'Server only title');
  api = await load(storage);
  globalThis.fetch = async () => { throw Error('offline'); };
  vm = api.buildVM(ctx());
  assert.equal(vm.wk.plays,'987'); assert.equal(vm.sampleChip,false); // pending background check stays quiet
  await flush(); vm = api.buildVM(ctx());
  assert.equal(vm.rd.weekHour,'22h–23h · 13 lượt');
  assert.equal(vm.wk.plays,'987'); assert.equal(vm.sampleChip,true); assert.match(vm.chipText,/đã lưu/); assert.equal(vm.unavailable,undefined);
  payload['/summary'].week = {...period,plays:999};
  globalThis.fetch = async url => reply(payload[new URL(url).pathname + new URL(url).search]);
  api.invalidate(()=>true); api.buildVM(ctx()); await flush();
  assert.equal(api.buildVM(ctx()).wk.plays,'999');
});


test('request timeout retains the last successful response', async () => {
  const api = await load();
  globalThis.fetch = async () => reply(rows);
  api.fetchJson('/recent'); await flush();
  api.invalidate(() => true);
  const originalTimeout = globalThis.setTimeout;
  let abortTimeout;
  globalThis.setTimeout = callback => { abortTimeout = callback; return originalTimeout(() => {}, 0); };
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  try {
    const entry = api.fetchJson('/recent');
    abortTimeout(); await flush();
    assert.equal(entry.st, 'err'); assert.equal(entry.status, 'timeout');
    assert.deepEqual(entry.data, rows);
  } finally { globalThis.setTimeout = originalTimeout; }
});

test('read-only refresh reloads server data without syncing Last.fm and keeps data on failure', async()=>{
  const api=await load();const calls=[];
  let fail=false,plays=1;
  globalThis.fetch=async(url,options={})=>{
    calls.push([new URL(url).pathname,options.method||'GET']);
    if(fail)throw Error('offline');
    return reply({rows:[{title:'Saved song',plays}]});
  };
  api.fetchJson('/recent?limit=5');await flush();
  plays=2;
  const refresh=api.refreshServerData();
  assert.equal(api.refreshServerData(),refresh);
  assert.equal(api.fetchJson('/recent?limit=5').data.rows[0].plays,1);
  assert.equal(await refresh,true);
  assert.equal(api.fetchJson('/recent?limit=5').data.rows[0].plays,2);
  fail=true;
  const offline=api.refreshServerData();api.fetchJson('/recent?limit=5');
  assert.equal(await offline,false);
  assert.equal(api.fetchJson('/recent?limit=5').data.rows[0].plays,2);
  assert.ok(calls.every(([path,method])=>path==='/recent' && method==='GET'));
});

