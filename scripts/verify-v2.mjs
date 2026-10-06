import {build} from 'esbuild';
import {loadEnv} from 'vite';
import assert from 'node:assert/strict';
const env=loadEnv('development',process.cwd(),'VITE_');
const built=await build({stdin:{contents:`export {API_BASE,API_TOKEN} from './src/config'; export {metadataIndex,trackMetadata,exportKey} from './src/lib/metadata'; export {default as supplemental} from './src/data/export-metadata.json'; export {SongListRow,ArtistListRow} from './src/screens/main'; export {createElement} from 'react'; export {renderToStaticMarkup} from 'react-dom/server';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify(env),'process.env.NODE_ENV':'"production"'}});
globalThis.window={localStorage:{getItem:()=>null,setItem:()=>{}}};
const app=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
async function get(path){const r=await fetch(app.API_BASE+path,{headers:{Authorization:'Bearer '+app.API_TOKEN}});assert.equal(r.status,200,path);return r.json();}
const rows=[];
for(let offset=0;;offset+=1000){const d=await get(`/library/tracks?offset=${offset}&limit=1000`);rows.push(...d.rows);if(d.rows.length<1000)break;}
const [stats,overview]=await Promise.all([get('/ratings'),get('/overview?scope=2026-09&limit=5000')]);
const index=app.metadataIndex(rows,stats,app.supplemental.items);
const song=overview.songs[0];const t=index.tracks[song.track_id];
assert.ok(t);assert.ok(t.duration_s);assert.ok(t.date_added);
const metadata=app.trackMetadata(t,'2026-10-02');
const html=app.renderToStaticMarkup(app.createElement(app.SongListRow,{r:{title:song.title,artist:song.artist,metadata,metric:`${song.plays} lượt`,rank:1}}));
assert.ok(html.includes('song-artwork'));assert.ok(html.includes('Năm phát hành'));assert.ok(html.includes('Độ dài bài hát'));
const artistHtml=app.renderToStaticMarkup(app.createElement(app.ArtistListRow,{r:{name:overview.artists[0].name,rank:1,big:'7h36m'}}));
assert.ok(artistHtml.includes('artist-tile'));assert.ok(artistHtml.includes('round'));
console.log(JSON.stringify({tracks:rows.length,libraryTracks:rows.filter(t=>t.in_library===1).length,ratings:stats.rows.length,matchedUpdateDates:rows.filter(t=>app.supplemental.items[app.exportKey(t)]?.updated).length,artistMetadata:Object.keys(index.artists).length,albumMetadata:Object.keys(index.albums).length,songSSR:'pass',artistSSR:'pass'}));
