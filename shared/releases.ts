export type ReleaseSource = 'MusicBrainz' | 'Bandcamp';
export type Release = { id:string; title:string; artist:string; date:string; type:string; owned:boolean; url:string; cover:string; sources?:ReleaseSource[] };
const fold=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// Only normalize Apple's format suffix. Deluxe, remaster, live and edition years remain distinct.
export const releaseTitle=(value:string)=>fold(value.replace(/\s*[-–]\s*(?:single|ep)\s*$/i,''));
const sameReleaseTitle=(a:Release,b:Release)=>releaseTitle(a.title)===releaseTitle(b.title)
  || a.type==='Live' && b.type==='Live' && releaseTitle(a.title.replace(/\s*\(live\)\s*$/i,''))===releaseTitle(b.title.replace(/\s*\(live\)\s*$/i,''));
export function mergeReleases(rows:Release[]):Release[] {
  const result:Release[]=[];
  for(const input of rows){
    const row=input;
    const matches=result.map((r,index)=>({r,index})).filter(({r})=>r.id===row.id || fold(r.artist)===fold(row.artist) && sameReleaseTitle(r,row)
      && (r.date===row.date || r.date.length<10 && row.date.startsWith(r.date) || row.date.length<10 && r.date.startsWith(row.date)));
    if(!matches.length){result.push(row);continue;}
    const merged=[...matches.map(m=>m.r),row].reduce((old,current)=>{
      const score=(release:Release)=>Number(release.sources?.includes('Bandcamp'))*4+Number(release.date.length===10)*2+Number(!!release.cover);
      const preferred=score(current)>score(old)?current:old;
      return {...preferred,date:old.date.length>current.date.length?old.date:current.date,owned:old.owned||current.owned,
        sources:[...new Set([...(old.sources || ['MusicBrainz' as const]),...(current.sources || ['MusicBrainz' as const])])]};
    });
    for(const {index} of matches.slice().reverse())result.splice(index,1);
    result.splice(matches[0].index,0,merged);
  }
  return result;
}
export const validReleaseCursor=(value:string)=>/^(?:b:)?\d+~\d+$/.test(value);
