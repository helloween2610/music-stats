// Cover badges are independent of a row's period rank or playlist position.
export function applyArtworkRanks(view:any, songs:any[] = [], albums:any[] = [], history?:{periods:string[];rows:any[]}) {
  const songRanks:Record<string,number> = {};
  const albumRanks:Record<string,number> = {};
  for(const row of songs)if(row.track_id && Number.isInteger(row.rank) && row.rank > 0)songRanks[row.track_id]=row.rank;
  for(const row of albums)if(row.album_artist && row.album && Number.isInteger(row.rank) && row.rank > 0)albumRanks[row.album_artist+'\u001f'+row.album]=row.rank;
  const changes:Record<string,number> = {};
  const comparisons:Record<string,string> = {};
  const previous:Record<string,{rank:number;period:string}> = {};
  for(const row of history?.rows || []) {
    const rank=songRanks[row.track_id];
    if(!rank)continue;
    // Lower numbers are better. The server's best covers all saved history,
    // including months older than the returned chart window.
    const candidates=[row.best,...(row.history || [])].filter(point=>
      point && Number.isInteger(point.rank) && point.rank>0 && typeof point.period==='string' && point.period);
    const best=candidates.reduce((best:any,point:any)=>!best || point.rank<best.rank ? point : best,null);
    if(best){
      changes[row.track_id]=best.rank-rank;
      comparisons[row.track_id]=best.period;
    }
    const points=new Map((row.history || []).filter((point:any)=>Number.isInteger(point.rank) && point.rank>0).map((point:any)=>[point.period,point]));
    for(const period of [...(history?.periods || [])].reverse()) {
      const point:any=points.get(period);
      if(point && point.rank!==rank){previous[row.track_id]=point;break;}
    }
  }
  view.currentSongRanks=songRanks;
  view.currentSongChanges=changes;
  view.currentSongComparisons=comparisons;
  const song=(row:any,id:string)=>{
    row.allTimeRank=songRanks[id];row.allTimeChange=changes[id];row.allTimeComparison=comparisons[id];
    row.allTimeBestRank=changes[id]==null?undefined:songRanks[id]+changes[id];
    row.allTimePreviousRank=previous[id]?.rank;row.allTimePreviousPeriod=previous[id]?.period;
  };
  for(const key of ['recent','top5','top15','top100Rows','periodRows','results','rising','risingAll'])
    for(const row of view[key] || [])song(row,row.tid);
  for(const row of view.album?.songs || [])song(row,row.tid);
  for(const row of view.artist?.songs || [])song(row,row.tid);
  for(const row of view.playlistLibrary || [])song(row,row.id);
  for(const row of view.albums || [])row.allTimeRank=albumRanks[row.ak];
}
