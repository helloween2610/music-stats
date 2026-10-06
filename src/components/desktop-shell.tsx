import monoLogo from '@/assets/mono-logo.jpg';
import type { Screen } from '@/state';
import { prevYm } from '@/lib/fmt';

export function desktopPeriodTitle(screen:Screen,today:string):string|undefined {
  const month=(ym:string)=>`M${ym.slice(5,7)}/${ym.slice(2,4)}`;
  if(screen==='overviewLastMonth')return month(prevYm(today));
  if(screen==='overviewThisMonth')return month(today);
  if(screen==='overviewThisYear')return `Y${today.slice(0,4)}`;
  return undefined;
}

const links: { screen: Screen; id?: string; label: string; path: string }[] = [
  {screen:'today', label:'Hôm nay', path:'M3 10 12 3l9 7v10H3ZM9 20v-7h6v7'},
  {screen:'trend', label:'Diễn biến', path:'m3 17 6-6 4 3 8-10M15 4h6v6'},
  {screen:'overviewLastMonth', label:'Last Month', path:'M4 4v16h16M8 16v-4m4 4V8m4 8V5'},
  {screen:'overviewThisMonth', label:'This Month', path:'M4 4v16h16M8 16v-4m4 4V8m4 8V5'},
  {screen:'overviewThisYear', label:'This Year', path:'M4 4v16h16M8 16v-4m4 4V8m4 8V5'},
  {screen:'overviewAllTime', label:'All Time', path:'M4 4v16h16M8 16v-4m4 4V8m4 8V5'},
  {screen:'top100', label:'Top 100 Song', path:'M9 18V5l10-2v13M9 18a3 2 0 1 1-3-2c2 0 3 1 3 2Zm10-2a3 2 0 1 1-3-2c2 0 3 1 3 2ZM9 9l10-2'},
  {screen:'periodTop', id:'albums~all', label:'Top 100 Album', path:'M4 3h16v18H4ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 12h.01'},
  {screen:'artistsAll', label:'Top 100 Artist', path:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2'},
  {screen:'releaseYears', label:'Năm phát hành', path:'M4 20h16M6 17v-5m6 5V5m6 12V9'},
  {screen:'releases', label:'Phát hành', path:'M4 5h16v16H4ZM8 3v4m8-4v4M4 11h16m-12 4h3m2 3h3'},
  {screen:'playlists', label:'Playlist', path:'M3 5h12M3 10h12M3 15h7m8-5v9m0-9 4 1m-4 8a3 2 0 1 1-3-2c2 0 3 1 3 2'},
  {screen:'library', label:'Thư viện', path:'M3 4h4v17H3ZM11 4h4v17h-4Zm7 0 3 17'},
];

export function DesktopNavigation({screen,id,open,today}:{screen:Screen;id?:string|null;open:(s:Screen,id?:string)=>void;today:string}) {
  return <aside className="web-sidebar">
    <button className="web-brand" onClick={()=>open('today')} aria-label="Sổ Nghe Nhạc — Hôm nay"><img className="web-brand-logo" src={monoLogo} alt="MONO"/></button>
    
    <nav aria-label="Điều hướng chính">{links.map((item)=><button key={item.screen} title={desktopPeriodTitle(item.screen,today) || item.label} className={screen===item.screen&&(!item.id||id?.startsWith(item.id+'~'))?'active':''} aria-current={screen===item.screen&&(!item.id||id?.startsWith(item.id+'~'))?'page':undefined} onClick={()=>open(item.screen,item.id ? `${item.id}~${today}` : undefined)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.path}/></svg><span>{desktopPeriodTitle(item.screen,today) || item.label}</span>
    </button>)}</nav>
    <div className="web-sidebar-footer"><span className="web-brand-mark small">♫</span><span>Nghe. Khám phá. Nhìn lại.<small>Music Stats · Web</small></span></div>
  </aside>;
}

export function DesktopHeader({title,back}:{title:string;back?:()=>void}) {
  return <header className="web-header"><div>{back&&<button onClick={back} aria-label="Quay lại">←</button>}<h1>{title}</h1></div></header>;
}
