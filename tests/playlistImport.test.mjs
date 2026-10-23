import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}};
const compiled=await build({entryPoints:['src/lib/playlist-import.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':'./src'},define:{'import.meta.env':'{}'}});
const app=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('pasted markdown playlist decodes HTML entities into title and artist',()=>{
 const rows=app.parsePastedPlaylistSongs(`**The Last Journey&#x20;**&#x41; Canorous Quintet\\
**The Somberlain&#x20;**&#x44;issection\\
**Perpetual Dawn&#x20;**&#x47;ates of Ishtar`);
 assert.deepEqual(rows.map(({title,artist})=>({title,artist})),[
  {title:'The Last Journey',artist:'A Canorous Quintet'},
  {title:'The Somberlain',artist:'Dissection'},
  {title:'Perpetual Dawn',artist:'Gates of Ishtar'},
 ]);
});

test('pasted playlist removes duplicates and accepts dash or pipe separators',()=>{
 const rows=app.parsePastedPlaylistSongs('Song One — Band\nSong One | Band\n2. Song Two\tOther Band\ninvalid');
 assert.deepEqual(rows.map(({title,artist})=>[title,artist]),[['Song One','Band'],['Song Two','Other Band']]);
});

test('pasted playlist accepts plain tab-separated title and artist rows',()=>{
 const rows=app.parsePastedPlaylistSongs('The Last Journey\tA Canorous Quintet\nThe Somberlain\tDissection\nPerpetual Dawn\tGates of Ishtar');
 assert.deepEqual(rows.map(({title,artist})=>({title,artist})),[
  {title:'The Last Journey',artist:'A Canorous Quintet'},
  {title:'The Somberlain',artist:'Dissection'},
  {title:'Perpetual Dawn',artist:'Gates of Ishtar'},
 ]);
});

test('rich clipboard rows keep the bold title boundary and normalize to tabs',()=>{
 const html='<div><strong>The Last Journey</strong> A Canorous Quintet</div><div><strong>The Somberlain</strong> Dissection</div><div><strong>Perpetual Dawn</strong> Gates of Ishtar</div>';
 const rows=app.parsePastedPlaylistSongs(html);
 assert.equal(app.formatPastedPlaylistSongs(rows),'The Last Journey\tA Canorous Quintet\nThe Somberlain\tDissection\nPerpetual Dawn\tGates of Ishtar');
});

test('plain title and artist lines remain resolvable candidates',()=>{
 const rows=app.parsePastedPlaylistSongCandidates('The Last Journey A Canorous Quintet\nThe Somberlain Dissection\nPerpetual Dawn Gates of Ishtar');
 assert.deepEqual(rows.map(({title,artist})=>({title,artist})),[
  {title:'The Last Journey A Canorous Quintet',artist:''},
  {title:'The Somberlain Dissection',artist:''},
  {title:'Perpetual Dawn Gates of Ishtar',artist:''},
 ]);
});
