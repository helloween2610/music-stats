// Identity keys for the user's Apple privacy export. Never use Track Identifier:
// it belongs to the personal library, not Apple's public catalog.
export const catalogName=(s:string)=>s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const personalVersion=(s:string)=>s.replace(/\s+\d+\.\d+(?=\s*(?:\(|$))/g,'').trim();
export const catalogAlbumBase=(s:string)=>s
  .replace(/\s*[([][^\])]*(?:version|inheritance|remaster|remastered|deluxe|expanded|edition)[^\])]*[\])]/gi,'')
  .replace(/\s*[-–]\s*(?:\d{4}\s+)?(?:version|inheritance|remaster|remastered|deluxe|expanded|edition).*$/i,'')
  .trim();
export function catalogKey(artist:string,title:string,album:string,library=false){
  return JSON.stringify([library?'library':'exact',catalogName(artist),catalogName(library?personalVersion(title):title),catalogName(library?personalVersion(album):album)]);
}
export function catalogKeys(artist:string,title:string,album:string,library=false){
  const keys=[catalogKey(artist,title,album,library)];
  const base=catalogAlbumBase(album);
  if(base && catalogName(base)!==catalogName(album))keys.push(catalogKey(artist,title,base,library));
  return [...new Set(keys)];
}
export const catalogId=(v:unknown):string|null=>
  (typeof v==='number' && Number.isSafeInteger(v) && v>0 || typeof v==='string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v))) ? String(v):null;
export type CatalogEntry={key:string;id:string|null};
export const catalogEntityKey=(kind:'artist'|'album',name:string)=>JSON.stringify([kind,catalogName(name)]);
export function indexApplePlaylists(rows:Record<string,unknown>[]):CatalogEntry[]{
  const groups=new Map<string,Set<string>>();
  for(const row of rows){
    const name=row?.Title,id=row?.['Public Playlist Identifier'];
    if(typeof name!=='string'||!name.trim()||typeof id!=='string'||!/^pl\.[A-Za-z0-9.-]+$/.test(id))continue;
    const key=JSON.stringify(['playlist',catalogName(name)]),ids=groups.get(key)||new Set<string>();ids.add(id);groups.set(key,ids);
  }
  return [...groups].map(([key,ids])=>({key,id:ids.size===1?[...ids][0]:null}));
}
export function indexAppleEntities(rows:Record<string,unknown>[],kind:'artist'|'album'):CatalogEntry[]{
  const groups=new Map<string,Set<string>>();
  for(const row of rows){
    if(!row||typeof row!=='object')continue;
    const name=row[kind==='artist'?'Artist Name':'Title'];
    if(typeof name!=='string'||!name.trim())continue;
    const raw=row[kind==='artist'?'Catalog Identifiers - Artist':'Catalog Identifiers - Album'];
    if(typeof raw!=='string')continue;
    // 1 is an export placeholder, not a usable catalog relationship.
    const ids=raw.split(',').map(s=>catalogId(s.trim())).filter((s):s is string=>!!s&&s!=='1');
    if(!ids.length)continue;
    const keys=[catalogEntityKey(kind,name)];
    if(kind==='album'){
      const base=catalogAlbumBase(name);
      if(base && catalogName(base)!==catalogName(name))keys.push(catalogEntityKey(kind,base));
    }
    for(const key of [...new Set(keys)]){
      const group=groups.get(key)||new Set<string>();
      ids.forEach(id=>group.add(id));groups.set(key,group);
    }
  }
  return [...groups].map(([key,ids])=>({key,id:ids.size===1?[...ids][0]:null}));
}
export function indexAppleExport(rows:Record<string,unknown>[]):CatalogEntry[]{
  const fields=['Apple Music Track Identifier','Audio Matched Track Identifier','Purchased Track Identifier','Tag Matched Track Identifier'];
  const groups=new Map<string,Set<string>>();
  for(const row of rows){
    if(!row||typeof row!=='object')continue;
    const artist=row.Artist,title=row.Title,album=row.Album;
    if(typeof artist!=='string'||!artist.trim()||typeof title!=='string'||!title.trim()||typeof album!=='string'||!album.trim())continue;
    const id=fields.map(f=>catalogId(row[f])).find(Boolean);if(!id)continue;
    for(const library of [false,true])for(const key of catalogKeys(artist,title,album,library)){
      const ids=groups.get(key)||new Set<string>();
      ids.add(id);groups.set(key,ids);
    }
  }
  // Keep ambiguous keys explicitly so a looser match cannot silently replace them.
  return [...groups].map(([key,ids])=>({key,id:ids.size===1?[...ids][0]:null}));
}
