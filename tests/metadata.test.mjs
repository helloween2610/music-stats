import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle = await build({entryPoints:['src/lib/metadata.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('Marvis song duration colors use the individual 2/3/4/5-hour thresholds',()=>{
  for(const [seconds,threshold,light,strong] of [
    [359,2,'gray','gray'],[360,2,'cyan','blue'],[479,2,'cyan','blue'],
    [480,3,'sage','lime'],[599,3,'sage','lime'],[600,4,'gold','amber'],
    [1199,4,'gold','amber'],[1200,5,'purple','violet'],[1201,5,'purple','violet'],
  ]) {
    assert.equal(m.durationTone(seconds,threshold-1/3600),light);
    assert.equal(m.durationTone(seconds,threshold),strong);
  }
});
test('date-added colors use completed calendar months, including year boundaries',()=>{
  const now='2026-10-02';
  for(const [date,tone] of [['2026-10-01','green'],['2026-09-03','green'],['2026-09-02','teal'],['2026-07-02','gray'],['2025-10-02','cyan'],['2024-10-02','sage'],['2023-10-02','gold'],['2021-10-02','purple'],['2026-11-01','gray'],['','gray']]) assert.equal(m.addedTone(date,now),tone,date);
});
test('release, artist listening days and Apple star colors follow independent scales',()=>{
  assert.deepEqual([1979,1980,1999,2000,2009,2010,2019,2020,2023,2024,2026].map(m.releaseTone),['purple','gold','gold','sage','sage','cyan','cyan','gray','gray','green','green']);
  assert.deepEqual([0,24,72,120,168,239.99,240,241].map(m.artistTone),['gray','gray','cyan','sage','gold','gold','purple','purple']);
  assert.deepEqual([0,20,40,60,80,100].map(m.ratingTone),['gray','gray','gray','cyan','sage','gold']);
});
test('metadata uses actual Date Modified, excludes removed songs from library count, keeps first addition, and totals album discs',()=>{
  const rows=[
    {id:'1',title:'First',artist:'A',album:'X',duration_s:480,my_rating:60,date_added:'2020-01-01',year:2012,in_library:0},
    {id:'2',title:'Second',artist:'A',album:'X',duration_s:601,date_added:'2025-01-01',year:2012,in_library:1},
    {id:'3',title:'Third',artist:'A',album:'X',duration_s:600,date_added:'2026-01-01',year:2012,in_library:1},
  ];
  const extra=Object.fromEntries(rows.map((r,i)=>[m.exportKey(r),{updated:`2026-02-0${i+1}`,trackCount: i===2?4:6,disc:i===2?2:1}]));
  const data=m.metadataIndex(rows,{rows:[{track_id:'1',plays:100},{track_id:'2',plays:12},{track_id:'3',plays:0}]},extra);
  assert.equal(data.artists.A.libraryTracks,2);
  assert.equal(data.artists.A.added,'2020-01-01');
  assert.equal(data.artists.A.updated,'2026-02-03');
  assert.equal(data.albums['A\x1fX'].totalTracks,10);
  assert.equal(data.albums['A\x1fX'].listened,1);
  assert.equal(data.tracks['2'].allHours,12*601/3600);
  const metadata=m.trackMetadata(data.tracks['2'],'2026-10-02');
  assert.equal(metadata.find(x=>x.title==='Độ dài bài hát').tone,'gold');
  assert.equal(metadata.some(x=>x.title==='Ngày cập nhật'),false);
});

test('date-added labels show completed days, weeks, months and years while retaining the exact date',()=>{
  for(const [date,now,label] of [
    ['2026-09-23','2026-10-04','+1w'],['2026-10-04','2026-10-04','+0d'],
    ['2026-09-05','2026-10-04','+4w'],['2026-09-04','2026-10-04','+1mo'],
    ['2025-10-05','2026-10-04','+11mo'],['2025-10-04','2026-10-04','+1y'],
    ['2024-10-04','2026-10-04','+2y'],['2024-02-29','2024-03-01','+1d'],
    ['2026-02-30','2026-10-04','—'],['','2026-10-04','—'],
    ['2026-10-05','2026-10-04','—'],
  ])assert.equal(m.addedAgeLabel(date,now),label);
  const added=m.trackMetadata({date_added:'2026-09-23'},'2026-10-04','2026-10-04')[0];
  assert.equal(added.text,'+1w');assert.equal(added.detail,'23/09/2026');assert.equal(added.tone,'green');
  assert.equal(m.collectionMetadata({added:'2025-07-17'},'2026-10-04',false,undefined,'2026-10-04')[0].text,'+1y');
});

test('compact ages retain exact timestamps and Vietnam time across midnight',()=>{
  const now='2026-10-04T06:34:00+07:00';
  for(const [date,expected] of [
    ['2026-10-03T23:16:00+07:00','7h'],['2026-10-03T16:16:00Z','7h'],
    ['2026-10-04T06:20:00+07:00','0h'],['2026-10-03T06:34:00+07:00','1d'],
    ['2026-09-27T06:35:00+07:00','6d'],['2026-09-27T06:34:00+07:00','1w'],
    ['2026-09-20T06:34:00+07:00','2w'],['2026-10-04','0d'],
    ['2026-10-05','—'],['invalid','—'],['2026-02-30','—'],
  ]) assert.equal(m.elapsedAgeLabel(date,now),expected,date);
  const last=Date.parse('2026-10-03T23:16:00+07:00')/1000;
  const items=m.trackMetadata({date_added:'2026-09-27',last_played:last},'2026-10-04',now);
  assert.deepEqual(items.map(x=>x.text),['+1w','▷7h']);
  assert.equal(items[1].detail,'03/10/2026, 23:16');
  assert.equal(items[1].color,'#32c759');
  assert.equal(m.trackMetadata({last_played:null},'2026-10-04',now).length,0);
});

test('Last Played colors follow the exported 12h/1d/3mo/6mo/1y rules',()=>{
  const now='2026-10-04T06:34:00+07:00';
  for(const [date,color] of [
    ['2026-10-03T18:35:00+07:00','#32c759'],
    ['2026-10-03T18:34:00+07:00','#cde8b5'],
    ['2026-10-03T06:35:00+07:00','#cde8b5'],
    ['2026-10-03T06:34:00+07:00',undefined],
    ['2026-07-05',undefined],['2026-07-04','#ffe700'],
    ['2026-04-05','#ffe700'],['2026-04-04','#ff3a30'],
    ['2025-10-05','#ff3a30'],['2025-10-04','#5e30eb'],
    ['2026-10-05',undefined],['',undefined],
  ]) assert.equal(m.lastPlayedColor(date,now),color,date);
});
