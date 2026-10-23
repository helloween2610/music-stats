import {indexAppleExport,indexAppleEntities,indexApplePlaylists,type CatalogEntry} from '../../shared/apple-catalog';
import type {SyncName,SyncFile} from './syncFiles';

export function parseCatalogFile(name:SyncName,bytes:Uint8Array):CatalogEntry[]{
  let rows:unknown;try{rows=JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/,''));}catch{throw Error('Không đọc được JSON: '+name+'. Dữ liệu ID cũ vẫn được giữ.');}
  if(!Array.isArray(rows)||!rows.length||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Không đọc được danh sách hợp lệ trong '+name+'.');
  const field=name.includes('Tracks')?'Track Identifier':name.includes('Albums')?'Album ID':name.includes('Artists')?'Artist Identifier':'Container Identifier';
  if(!rows.some(row=>field in row))throw Error('Không đúng cấu trúc export trong '+name+'.');
  if(name.includes('Tracks'))return indexAppleExport(rows);
  if(name.includes('Albums'))return indexAppleEntities(rows,'album');
  if(name.includes('Artists'))return indexAppleEntities(rows,'artist');
  return indexApplePlaylists(rows);
}
export async function prepareCatalog(db:D1Database,jobId:string,files:Map<SyncName,SyncFile>){
  const saved=await db.prepare("SELECT value FROM sync_state WHERE key='catalog_cloud_sources'").first<{value:string}>();
  const fingerprints:Record<string,string>=saved?JSON.parse(saved.value):{},updates:Record<string,string>={},entries:CatalogEntry[]=[];
  // Validate every changed JSON before staging or changing any live ID.
  for(const [name,file] of files){
    if(name==='Library.xml'||fingerprints[name]===file.fingerprint)continue;
    entries.push(...parseCatalogFile(name,await file.read()));updates[name]=file.fingerprint;
  }
  // An export contains many unchanged IDs. Avoid rewriting them on every file update.
  const existing=entries.length?await db.prepare('SELECT match_key,catalog_id FROM apple_catalog_links').all<{match_key:string;catalog_id:string|null}>():{results:[]};
  const known=new Map(existing.results.map(row=>[row.match_key,row.catalog_id]));
  const changedEntries=entries.filter(e=>!known.has(e.key)||known.get(e.key)!==e.id);
  await db.prepare('DELETE FROM apple_catalog_staging').run();
  for(let i=0;i<changedEntries.length;i+=100)await db.batch(changedEntries.slice(i,i+100).map(e=>db.prepare('INSERT INTO apple_catalog_staging(job_id,match_key,catalog_id) VALUES (?1,?2,?3)').bind(jobId,e.key,e.id)));
  return {files:Object.keys(updates).length,keys:changedEntries.length,fingerprints:{...fingerprints,...updates},changed:Object.keys(updates).length>0};
}
export async function commitCatalog(db:D1Database,jobId:string,prepared:Awaited<ReturnType<typeof prepareCatalog>>){
  if(!prepared.changed)return;
  // Atomic publication; failed downloads/staging never replace the saved catalog.
  // Keep historical keys absent in a newer export, since archive tracks still use them.
  await db.batch([
    db.prepare(`INSERT INTO apple_catalog_links(match_key,catalog_id,source)
      SELECT match_key,catalog_id,'Apple privacy export' FROM apple_catalog_staging WHERE job_id=?1
      ON CONFLICT(match_key) DO UPDATE SET catalog_id=excluded.catalog_id,source=excluded.source,imported_at=datetime('now')`).bind(jobId),
    db.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES ('catalog_cloud_sources',?1,datetime('now'))").bind(JSON.stringify(prepared.fingerprints)),
    db.prepare("DELETE FROM discovery_cache WHERE key LIKE 'apple-detail:verified:%' OR key LIKE 'apple-album:verified:%'"),
    db.prepare('DELETE FROM apple_catalog_staging WHERE job_id=?1').bind(jobId),
  ]);
}
