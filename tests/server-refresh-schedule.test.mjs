import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/server-refresh-schedule.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {serverRefreshWindow,ServerRefreshSchedule}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const vn=value=>Date.parse(value+'+07:00');
test('weekday refreshes follow server hours plus five minutes, not time since opening',()=>{
  for(const [now,last,next] of [
    ['2026-10-05T06:40:00','2026-10-05T00:05:00','2026-10-05T07:05:00'],
    ['2026-10-05T07:04:59','2026-10-05T00:05:00','2026-10-05T07:05:00'],
    ['2026-10-05T07:05:00','2026-10-05T07:05:00','2026-10-05T09:05:00'],
    ['2026-10-05T09:06:00','2026-10-05T09:05:00','2026-10-05T12:05:00'],
    ['2026-10-05T12:05:00','2026-10-05T12:05:00','2026-10-05T13:05:00'],
    ['2026-10-05T18:05:00','2026-10-05T18:05:00','2026-10-05T20:05:00'],
  ])assert.deepEqual(serverRefreshWindow(vn(now)),{last:vn(last),next:vn(next)},now);
});
test('weekend, midnight and year transitions use Vietnam local day',()=>{
  for(const [now,next] of [
    ['2026-10-03T00:06:00','2026-10-03T02:05:00'],
    ['2026-10-04T09:06:00','2026-10-04T11:05:00'],
    ['2026-10-04T11:06:00','2026-10-04T12:05:00'],
    ['2026-10-04T23:06:00','2026-10-05T00:05:00'],
    ['2026-10-05T00:06:00','2026-10-05T07:05:00'],
    ['2026-12-31T23:06:00','2027-01-01T00:05:00'],
  ])assert.equal(serverRefreshWindow(vn(now)).next,vn(next),now);
});
test('background/offline skips requests and catches up only once on resume',()=>{
  const schedule=new ServerRefreshSchedule(vn('2026-10-05T06:40:00'));
  assert.equal(schedule.takeDue(vn('2026-10-05T07:04:59'),true),false);
  assert.equal(schedule.takeDue(vn('2026-10-05T07:05:00'),false),false);
  assert.equal(schedule.takeDue(vn('2026-10-05T13:15:00'),true),true);
  assert.equal(schedule.takeDue(vn('2026-10-05T13:15:01'),true),false);
  assert.equal(schedule.takeDue(vn('2026-10-05T14:05:00'),true),true);
});
test('opening after a slot does not duplicate the initial data load',()=>{
  const now=vn('2026-10-05T07:10:00'),schedule=new ServerRefreshSchedule(now);
  assert.equal(schedule.takeDue(now,true),false);
  assert.equal(schedule.takeDue(vn('2026-10-05T09:05:00'),true),true);
});
