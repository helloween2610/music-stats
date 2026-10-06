import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(path){const b=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {explainMetadata}=await load('src/lib/metadata-help.ts');
const {trackMetadata}=await load('src/lib/metadata.ts');
test('date help retains full timestamp and correct thresholds instead of inferring from rounded text',()=>{
  const items=trackMetadata({date_added:'2026-09-27',last_played:'2026-10-03T16:00:00Z',duration_s:600,allHours:4},'2026-10-04','2026-10-04T00:00:00Z');
  const lp=items.find(x=>x.title==='Lần nghe cuối');
  const explanation=explainMetadata(lp);
  assert.equal(explanation.value,'▷8h');
  assert.ok(explanation.lines.some(s=>s.includes(lp.detail)));
  assert.ok(explanation.lines.some(s=>s.includes('dưới 12 giờ')||s.includes('Dưới 12 giờ')));
  assert.ok(explainMetadata(items.find(x=>x.title==='Độ dài bài hát')).lines.some(s=>s.includes('4 giờ')));
  assert.ok(explainMetadata(items.find(x=>x.title==='Thêm vào thư viện')).lines.some(s=>s.includes('w = tuần')));
});
