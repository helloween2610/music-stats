import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/lib/period-alltime-rise.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const app=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('All time comparison spans the selected month or year and caps an unfinished period',()=>{
 for(const [scope,asOf,before,end] of [
  ['2026-09','2026-10-04','2026-08-31','2026-09-30'],
  ['2026-10','2026-10-04','2026-09-30','2026-10-04'],
  ['2026-01','2026-02-02','2025-12-31','2026-01-31'],
  ['2024-02','2024-03-04','2024-01-31','2024-02-29'],
  ['2026','2026-10-04','2025-12-31','2026-10-04'],
 ])assert.deepEqual(app.allTimeRiseWindow(scope,asOf),{before,end});
});
test('missing or unranked All time comparisons never qualify as positive movement',()=>{
 const changes=app.allTimeRankChanges([{id:'up',rank:4},{id:'flat',rank:8},{id:'down',rank:10},{id:'new',rank:1},{id:'bad',rank:0}],[{id:'up',rank:7},{id:'flat',rank:8},{id:'down',rank:9},{id:'bad',rank:3}],r=>r.id);
 assert.deepEqual([...changes],[['up',3],['flat',0],['down',-1]]);
});
test('closed song months use saved snapshots; the open month uses the current rank',()=>{
 const history={asOf:'2026-10-04',rows:[{track_id:'A',rank:50,history:[{period:'T08/26',rank:54},{period:'T09/26',rank:49}]},{track_id:'unknown',rank:1,history:[]}]};
 assert.deepEqual([...app.songAllTimeChanges(history,'2026-08-31','2026-09-30')],[['A',5]]);
 assert.deepEqual([...app.songAllTimeChanges(history,'2026-09-30','2026-10-04')],[['A',-1]]);
});
