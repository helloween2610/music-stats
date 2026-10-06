import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export {applyArtworkRanks} from './src/lib/artwork-ranks'; export {ArtworkRank} from './src/components/artwork-rank'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const app=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('cover rank stays current All time across periods, playlists and album scopes',()=>{
  const v={top5:[{tid:'TR1',rank:1,change:20}],periodRows:[{tid:'TR1',rank:7},{tid:'TR2',rank:2}],artist:{songs:[{tid:'TR1',rank:3}]},playlistLibrary:[{id:'TR1'},{id:'TR2'}],albums:[{ak:'Band\u001fAlbum',rank:1}]};
  app.applyArtworkRanks(v,[{track_id:'TR1',rank:54}],[{album_artist:'Band',album:'Album',rank:16}]);
  assert.equal(v.top5[0].allTimeRank,54);
  assert.equal(v.top5[0].rank,1);
  assert.equal(v.top5[0].change,20);
  assert.equal(v.periodRows[0].allTimeRank,54);
  assert.equal(v.periodRows[1].allTimeRank,undefined);
  assert.equal(v.artist.songs[0].allTimeRank,54);
  assert.equal(v.playlistLibrary[0].allTimeRank,54);
  assert.equal(v.playlistLibrary[1].allTimeRank,undefined);
  assert.equal(v.currentSongRanks.TR1,54);
  assert.equal(v.albums[0].allTimeRank,16);
  app.applyArtworkRanks(v,[{track_id:'TR1',rank:49}]);
  assert.equal(v.top5[0].allTimeRank,49);
  assert.equal(v.albums[0].allTimeRank,undefined);
});
test('unranked covers do not display an index or invalid rank',()=>{
  for(const rank of [undefined,null,0,-1,NaN,1.5])assert.equal(app.renderToStaticMarkup(app.createElement(app.ArtworkRank,{rank})),'');
  const html=app.renderToStaticMarkup(app.createElement(app.ArtworkRank,{rank:54}));
  assert.match(html,/Hạng All time hiện tại: 54/);
  assert.match(html,/>54<\/span>/);
});

test('cover changes compare with the best recorded rank, including unchanged snapshots',()=>{
  const view={periodRows:[{tid:'TR1',rank:1,change:20},{tid:'TR2'},{tid:'TR3'},{tid:'TR4'}],playlistLibrary:[{id:'TR1'}]};
  app.applyArtworkRanks(view,[{track_id:'TR1',rank:170},{track_id:'TR2',rank:41},{track_id:'TR3',rank:60},{track_id:'TR4',rank:368}],[],{
    periods:['T06/26','T07/26','T08/26','T09/26'],rows:[
      {track_id:'TR1',previous:170,history:[{period:'T06/26',rank:240},{period:'T08/26',rank:218},{period:'T09/26',rank:170}]},
      {track_id:'TR2',previous:41,history:[{period:'T06/26',rank:45},{period:'T07/26',rank:39},{period:'T08/26',rank:41},{period:'T09/26',rank:41}]},
      {track_id:'TR3',previous:60,history:[{period:'T06/26',rank:60},{period:'T09/26',rank:60}]},
      {track_id:'TR4',previous:null,history:[{period:'T08/26',rank:0},{period:'T09/26',rank:null}]}
    ]});
  assert.deepEqual(view.periodRows.map(r=>r.allTimeChange),[0,-2,0,undefined]);
  assert.equal(view.periodRows[0].change,20);
  assert.equal(view.playlistLibrary[0].allTimeChange,0);
  assert.equal(view.playlistLibrary[0].allTimeComparison,'T09/26');
  assert.deepEqual(view.currentSongComparisons,{TR1:'T09/26',TR2:'T07/26',TR3:'T06/26'});
  assert.deepEqual(view.periodRows.map(r=>r.allTimeBestRank),[170,39,60,undefined]);
  assert.deepEqual(view.periodRows.map(r=>r.allTimePreviousRank),[218,39,undefined,undefined]);
  assert.equal(view.periodRows[0].allTimePreviousPeriod,'T08/26');
  for(const [change,arrow,comparison] of [[48,'▲48','T08/26'],[-2,'▼2','T07/26']]) {
    const html=app.renderToStaticMarkup(app.createElement(app.ArtworkRank,{rank:170,change,comparison}));
    assert.ok(html.replace(/<[^>]*>/g,'').includes(arrow));
    assert.ok(html.includes('hạng tốt nhất trước đó #'+(170+change)) && html.includes(comparison));
  }
  app.applyArtworkRanks(view,[{track_id:'TR1',rank:170}]);
  assert.equal(view.periodRows[0].allTimeChange,undefined);
  assert.equal(view.periodRows[0].allTimeComparison,undefined);
  assert.equal(view.periodRows[0].allTimePreviousRank,undefined);
});

test('a changed latest snapshot takes precedence over earlier movements',()=>{
  const view={recent:[{tid:'TR1'}]};
  app.applyArtworkRanks(view,[{track_id:'TR1',rank:59}],[],{periods:['T08/26','T09/26'],rows:[{track_id:'TR1',history:[{period:'T08/26',rank:80},{period:'T09/26',rank:58}]}]});
  assert.equal(view.recent[0].allTimeChange,-1);
  assert.equal(view.recent[0].allTimeComparison,'T09/26');
});

test('unchanged All time ranks show only the rank without a zero arrow',()=>{
  const html=app.renderToStaticMarkup(app.createElement(app.ArtworkRank,{rank:179,change:0}));
  assert.ok(!html.includes('→0'));
  assert.ok(!html.includes('artwork-rank-change'));
  assert.ok(html.includes('179'));
});


test('best historical rank matches both requested examples and uses records outside the chart window',()=>{
  const view={recent:[{tid:'down'},{tid:'up'},{tid:'older'}],rising:[{tid:'down'}],risingAll:[{tid:'up'}],album:{songs:[{tid:'older'}]}};
  app.applyArtworkRanks(view,[{track_id:'down',rank:20},{track_id:'up',rank:19},{track_id:'older',rank:20}],[],{
    periods:['T08/26','T09/26'],rows:[
      {track_id:'down',history:[{period:'T09/26',rank:18},{period:'T08/26',rank:19}]},
      {track_id:'up',history:[{period:'T09/26',rank:25},{period:'T08/26',rank:20}]},
      {track_id:'older',best:{rank:12,period:'T01/22'},history:[{period:'T08/26',rank:21},{period:'T09/26',rank:23}]},
    ],
  });
  assert.deepEqual(view.recent.map(r=>[r.allTimeChange,r.allTimeComparison]),[[-2,'T09/26'],[1,'T08/26'],[-8,'T01/22']]);
  assert.equal(view.rising[0].allTimeChange,-2);assert.equal(view.risingAll[0].allTimeChange,1);assert.equal(view.album.songs[0].allTimeChange,-8);
  for(const [rank,change,arrow] of [[20,-2,'▼2'],[19,1,'▲1']])assert.ok(app.renderToStaticMarkup(app.createElement(app.ArtworkRank,{rank,change})).replace(/<[^>]*>/g,'').includes(arrow));
});
