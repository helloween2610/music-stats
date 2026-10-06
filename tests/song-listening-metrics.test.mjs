import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:`export {SongListeningMetrics} from './src/components/song-listening-metrics';export {SongRankProgress} from './src/components/song-rank-progress';export {SongListRow,RisingRow} from './src/screens/main';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
globalThis.window={localStorage:{getItem:()=>null}};
const app=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const render=(component,props)=>app.renderToStaticMarkup(app.createElement(component,props));
test('non-All-time metrics keep plays first; All time switches long songs to listening time',()=>{
  for(const [duration,timeFirst] of [[359,false],[360,true],[632,true],[undefined,false]]){
    const html=render(app.SongListeningMetrics,{plays:'94 lượt',listening:'16h 30m',duration,timeFirst:true});
    assert.match(html,timeFirst?/<strong[^>]*>16h 30m<\/strong><span[^>]*>94x<\/span>/:/<strong[^>]*>94x<\/strong><span[^>]*>16h 30m<\/span>/);
  }
  assert.match(render(app.SongListeningMetrics,{plays:'94 lượt',listening:'16h 30m',duration:632}),/<strong[^>]*>94x<\/strong><span[^>]*>16h 30m<\/span>/);
  assert.match(render(app.SongListeningMetrics,{plays:'0 lượt',listening:'0m',duration:360,timeFirst:true}),/<strong[^>]*>0m<\/strong><span[^>]*>0x<\/span>/);
});
test('rising rows use inline listening metrics and show both rank transitions below the chart',()=>{
  for(const duration of [359,360]) {
    const html=render(app.RisingRow,{r:{title:'Song',artist:'Band',metric:'94 lượt',listening:'16h 30m',duration_s:duration,up:'▲12',spark:'CHART',allTimeBestRank:18,allTimePreviousRank:25,allTimeRank:20,allTimePreviousPeriod:'T09/26'}});
    assert.ok(html.includes('song-metrics-inline'));
    assert.match(html,/<strong[^>]*>94x<\/strong><span[^>]*>16h 30m<\/span>/);
    assert.ok(!html.includes('▲12'));
    assert.ok(html.indexOf('CHART')<html.indexOf('song-rank-progress'));
    assert.match(html,/rank-down[^>]*>▶/);
    assert.match(html,/rank-up[^>]*>▶/);
    assert.ok(html.includes('Hạng tốt nhất #18; hạng khác hiện tại gần nhất (T09/26) #25; hạng hiện tại #20'));
  }
});
test('shared song rows support metadata duration and hide period change badges and retain explicit right content',()=>{
  const r={title:'Long song',artist:'Band',metric:'94 lượt',listening:'16h 30m',timeFirst:true,metadata:[{title:'Độ dài bài hát',text:'10:32'}],chg:'▲2'};
  const html=render(app.SongListRow,{r});
  assert.match(html,/<strong[^>]*>16h 30m<\/strong><span[^>]*>94x<\/span>/);
  assert.ok(!html.includes('▲2'));
  const recent=render(app.SongListRow,{r,right:'23:12'});
  assert.ok(recent.includes('23:12'));assert.ok(!recent.includes('16h 30m'));
  const missing=render(app.SongListeningMetrics,{plays:'94 lượt',duration:360});
  assert.match(missing,/<strong[^>]*>94x<\/strong>/);
});

 test('rank progress removes hash signs and merges only adjacent equal ranks',()=>{
  for(const [ranks,expected] of [
    [[18,18,20],'18▶20'],[[18,20,20],'18▶20'],
    [[20,20,20],'20'],[[41,47,41],'41▶47▶41'],
  ]) {
    const html=render(app.SongRankProgress,{best:ranks[0],previous:ranks[1],current:ranks[2]});
    assert.equal(html.replace(/<[^>]*>/g,''),expected);
    assert.equal((html.match(/<strong /g)||[]).length,expected.match(/\d+/g).length);
  }
});
