import {useEffect,useState} from 'react';
import {loadAppleDetail} from '@/lib/discovery';
import {MusicMetadata} from './music-metadata';
import {releaseTone} from '@/lib/metadata';

export function RecentAlbumYear({artist,title,album}:{artist:string;title:string;album:string}) {
  const [year,setYear]=useState<number>();
  useEffect(()=>{
    let active=true;setYear(undefined);
    if(artist && title && album)void loadAppleDetail({kind:'song',artist,title,album}).then(data=>{
      if(active && data.status==='found' && Number.isInteger(data.releaseYear) && data.releaseYear!>=1000 && data.releaseYear!<=9999)setYear(data.releaseYear);
    }).catch(()=>{});
    return()=>{active=false;};
  },[artist,title,album]);
  return year ? <MusicMetadata items={[{text:String(year),title:'Năm phát hành',tone:releaseTone(year)}]}/> : null;
}
