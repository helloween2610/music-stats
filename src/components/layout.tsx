import {screenView, rememberView, saveViews} from '@/lib/view-preferences';
import {MetadataHelpProvider} from './metadata-help';
import { AlbumScreen } from '@/screens/album';
import { ShortcutProvider } from './shortcuts';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { dow, vnToday, ymd } from '@/lib/fmt';
import { useAtom } from "jotai";
import {
  AnimationRoutes, App, BottomNavigation, Header, Icon, Page, Route, SnackbarProvider, ZMPRouter,
  useLocation, useNavigate, useParams,
} from "zmp-ui";
import { minimizeApp } from "zmp-sdk/apis";
import { periodTopTitle, topPeriod } from "@/lib/period-top";
import { listDisplayLimit } from "@/lib/list-preferences";
import { useSwipeBack } from "./swipe-back";
import { BROWSER_PREVIEW, DESKTOP_WEB, IOS_APP } from "@/config";
import { parentPage, rememberParent } from "@/lib/navigation";
import { longPress } from "@/lib/long-press";
import { lockTextSelection } from "@/lib/selection-lock";

import { invalidate, useApiRefresh, useServerUpdates } from "@/lib/api";
import { PullRefresh } from './pull-refresh';
import { LIBREQ } from "@/lib/sync";
import { pathOf, Screen, TAB_ICONS, TAB_LABELS, TABS, tabOf, TITLE, uiAtom, UI, WEB_OVERVIEW_SCOPES } from "@/state";
import { buildVM, Ctx } from "@/vm";
import { ScopeTabs, EmptyState, LoadingView } from "./ui";
import { FindSheet, ShareSheet } from "./sheets";
import { ArtistsAllScreen, NativeWidgetPlaylistPublisher, RecentScreen, PeriodTopScreen, OverviewScreen, RisingScreen, Top100Screen, TodayScreen, TrendScreen, TopPlaylistsScreen } from "@/screens/main";
import { ArtistScreen, LibraryScreen, RulesScreen, SongScreen, UnmatchedScreen } from "@/screens/detail";

import { ReleasesScreen } from "@/screens/discovery";

import { PlaylistsScreen, PlaylistScreen, WidgetPlaylistDeepLink } from "@/screens/playlists";
import { NotificationsPopup, NotificationsScreen } from "@/screens/notifications";
import { loadNotifications, notificationSnapshot, subscribeNotifications } from "@/lib/notifications";

import { DesktopTodayScreen, DesktopOverviewScreen, DesktopTrendScreen, DesktopReleaseYearsScreen } from "@/screens/desktop";
import { DesktopNavigation, DesktopHeader, desktopPeriodTitle } from "./desktop-shell";
import { NativeAppBackdrop, NativeMiniPlayer, NowPlayingScreen } from "./native-player";
import { WidgetPreviewScreen } from "@/screens/widget-preview";

const SCREENS: Record<Screen, (x: any) => JSX.Element> = {
  album: AlbumScreen, recent: RecentScreen, playlists: PlaylistsScreen, playlist: PlaylistScreen, topPlaylists: TopPlaylistsScreen,
  periodTop: PeriodTopScreen, today: TodayScreen, top100: Top100Screen, artistsAll: ArtistsAllScreen, trend: TrendScreen,
  overview: OverviewScreen, releases: ReleasesScreen, settings: LibraryScreen, library: LibraryScreen, unmatched: UnmatchedScreen, rules: RulesScreen, rising: RisingScreen, song: SongScreen, artist: ArtistScreen,
  notifications: NotificationsScreen, releaseYears: DesktopReleaseYearsScreen,
  player: NowPlayingScreen,
  widgetPreview: WidgetPreviewScreen,
  overviewLastMonth: DesktopOverviewScreen, overviewThisMonth: DesktopOverviewScreen,
  overviewThisYear: DesktopOverviewScreen, overviewAllTime: DesktopOverviewScreen,
};

const ROUTES: [string, Screen][] = [
  ["/", "today"], ["/trend", "trend"], ["/overview", "overview"], ["/releases", "releases"], ["/settings", "settings"], ["/library", "settings"],
  ["/notifications", "notifications"],
  ["/recent", "recent"], ["/playlists", "playlists"], ["/playlists/:id", "playlists"], ["/playlist/:id", "playlist"], ["/top-playlists", "topPlaylists"],
  ["/period-top/:id", "periodTop"], ["/top100", "top100"], ["/artists", "artistsAll"], ["/unmatched", "unmatched"], ["/rules", "rules"], ["/rising", "rising"], ["/album/:id", "album"], ["/song/:id", "song"], ["/artist/:id", "artist"],
];

if (IOS_APP || BROWSER_PREVIEW) ROUTES.push(["/player", "player"]);
if (BROWSER_PREVIEW) ROUTES.push(["/widget-preview", "widgetPreview"]);

if (DESKTOP_WEB) ROUTES.push(["/release-years", "releaseYears"],
  ["/last-month", "overviewLastMonth"], ["/this-month", "overviewThisMonth"],
  ["/this-year", "overviewThisYear"], ["/all-time", "overviewAllTime"]);

const screenOf = (pathname: string): Screen => {
  const seg = pathname.split("/")[1] || "";
  const hit = ROUTES.find(([path]) => path.split("/")[1] === seg);
  return hit ? hit[1] : "today";
};
const SHORT_WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEB_TOP_LIMITS={songs:100,albums:24,artists:32,playlists:25};
const topLimit = (kind:keyof typeof WEB_TOP_LIMITS, preference:unknown) => kind==='songs' || DESKTOP_WEB ? WEB_TOP_LIMITS[kind] : listDisplayLimit(false,preference);
const topShortcuts = (preference:unknown):QuickShortcut[] => [
  {label:`Top ${topLimit('songs',preference)} bài`,sub:'All time',screen:'top100',icon:'♪'},
  {label:`Top ${topLimit('albums',preference)} album`,sub:'All time',screen:'periodTop',id:'albums~all',icon:'□'},
  {label:`Top ${topLimit('artists',preference)} nghệ sĩ`,sub:'All time',screen:'artistsAll',icon:'◉'},
  {label:`Top ${topLimit('playlists',preference)} playlist`,sub:'Ranking playlist',screen:'topPlaylists',icon:'▦'},
];
const TREND_SHORTCUTS: QuickShortcut[] = [
  {label:'Đang lên hạng',sub:'Diễn biến',screen:'trend',view:{trendMode:'rising'},icon:'↗'},
  {label:'Tháng trước',sub:'Tổng quan',screen:'trend',view:{trendMode:'Tháng trước'},icon:'T-1'},
  {label:'Tháng này',sub:'Tổng quan',screen:'trend',view:{trendMode:'Tháng'},icon:'T'},
  {label:'Năm nay',sub:'Tổng quan',screen:'trend',view:{trendMode:'Năm'},icon:'Y'},
];
const RELEASE_SHORTCUTS: QuickShortcut[] = [
  {label:'Gợi ý',sub:'Album tương tự',screen:'releases',view:{releaseMode:'recommend'},icon:'★'},
  {label:'Mới phát hành',sub:'90 ngày gần đây',screen:'releases',view:{releaseMode:'recent'},icon:'↺'},
  {label:'Sắp ra mắt',sub:'12 tháng tới',screen:'releases',view:{releaseMode:'upcoming'},icon:'○'},
  {label:'Cài đặt',sub:'Nguồn phát hành',screen:'releases',view:{releaseMode:'settings'},icon:'⚙'},
];
type QuickShortcut = {label:string;sub:string;screen:Screen;id?:string;icon:string;view?:Partial<UI>};

// Điều hướng + trạng thái dùng chung cho mọi màn.
function useCtx(screen: Screen, id: string | null): Ctx {
  const [stored, setP] = useAtom(uiAtom);
  const key=pathOf(screen,id);
  const p=screenView(stored,key);
  if(p.rankFocus && ((screen==='top100' && p.rankFocus.kind==='song') || (screen==='artistsAll' && p.rankFocus.kind==='artist')))Object.assign(p,{filter:"Tất cả",artistFilter:"Tất cả",songView:"Danh sách",sort:"Giờ nghe"});
  const navigate = useNavigate();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return {
    p, screen, id,
    set: (fn) => setP((q: UI) => {
      const patch=fn(screenView(q,key));
      const views=rememberView(q.views,key,patch);
      if(views!==q.views)saveViews(views);
      const changedView=Object.keys(patch).some(k=>["sort","filter","artistFilter","songView"].includes(k));
      return {...q,...patch,views,...(changedView?{rankFocus:undefined}:{})};
    }),
    go: (s, sid = null, view) => {
      if (s === screen && sid === id && !view) return;
      setP(q => {
        const targetKey=pathOf(s,sid);
        const views=view ? rememberView(q.views,targetKey,view) : q.views;
        if(view)saveViews(views);
        return { ...q, ...view, views, pageParents: rememberParent({ screen, id }, { screen: s, id: sid }, q.tab, q.pageParents) };
      });
      navigate(pathOf(s, sid));
    },
    goTab: (screen) => {
      const k = TABS.indexOf(screen);
      setP((q) => ({ ...q, tab: k }));
      navigate(pathOf(TABS[k]), { replace: true, animate: false });
    },
    later: (ms, fn) => { timers.current.push(setTimeout(fn, ms)); },
    ptoast: (msg) => {
      setP((q) => ({ ...q, ptoast: msg }));
      setTimeout(() => setP((q) => (q.ptoast === msg ? { ...q, ptoast: "" } : q)), 2600);
    },
  };
}

function ScreenPage({ screen }: { screen: Screen }) {
  const params = useParams();
  useApiRefresh();
  const c = useCtx(screen, params.id ?? null);
  const fixedScope=DESKTOP_WEB ? WEB_OVERVIEW_SCOPES[screen] : undefined;
  const trendScope = !DESKTOP_WEB && screen === "trend" && c.p.trendMode !== "rising" ? c.p.trendMode : "";
  const mobileOverviewScope = !DESKTOP_WEB && screen === "overview" ? "All time" : "";
  const standalone = screen === 'notifications' || screen === 'player' || screen === 'widgetPreview';
  const vm = screen === 'widgetPreview'
    ? buildVM({...c,screen:'today'})
    : standalone ? null : buildVM(fixedScope ? {...c,screen:'overview',p:{...c.p,scope:fixedScope}} : trendScope ? {...c,screen:'overview',id:`trend~${c.p.trendAsOf}`,p:{...c.p,scope:trendScope}} : mobileOverviewScope ? {...c,p:{...c.p,scope:mobileOverviewScope}} : c);
  const View = DESKTOP_WEB ? ({today: DesktopTodayScreen, overview: DesktopOverviewScreen, trend: DesktopTrendScreen}[screen] || SCREENS[screen]) : SCREENS[screen];
  useEffect(() => {
    if (screen !== "settings") return;
    LIBREQ.screenOpen = true;
    return () => { LIBREQ.screenOpen = false; };
  }, [screen]);
  const ambientBackdrop = (IOS_APP || BROWSER_PREVIEW) && screen !== 'player' && screen !== 'widgetPreview';
  return (
    <MetadataHelpProvider screenKey={pathOf(screen,c.id)}><ShortcutProvider c={c} vm={vm}><Page className={`sc screen-${screen}`} hideScrollbar restoreScrollOnBack>
      {ambientBackdrop && <NativeAppBackdrop/>}
      <div className="screen-foreground">
      {screen !== 'player' && screen !== 'widgetPreview' && <PullRefresh notify={c.ptoast} />}
      {standalone ? <View c={c} vm={vm || {}} /> : <>
      {vm!.isLoading ? <LoadingView /> : vm!.unavailable ? (
        <EmptyState title="Chưa có dữ liệu" note={vm!.unavailable}
          action={{ label: "Thử lại", onTap: () => invalidate(() => true) }} />
      ) : <View vm={vm!} c={c} />}
      {!vm!.isLoading && !vm!.unavailable && (screen === "song" || screen === "artist") && <ShareSheet vm={vm!} c={c} />}
      {!vm!.isLoading && !vm!.unavailable && (screen === "settings" || screen === "library" || screen === "unmatched") && <FindSheet vm={vm!} c={c} />}
      </>}
      </div>
    </Page></ShortcutProvider></MetadataHelpProvider>
  );
}

function NativeWidgetPlaylistData({c}:{c:Ctx}) {
  useApiRefresh();
  const vm=buildVM({...c,screen:'today',id:null});
  return <NativeWidgetPlaylistPublisher vm={vm}/>;
}


function Shell() {
  useServerUpdates();
  const location = useLocation();
  const navigate = useNavigate();
  const [p, setP] = useAtom(uiAtom);
  const [quickMenu,setQuickMenu] = useState<Screen|null>(null);
  const notifications=useSyncExternalStore(subscribeNotifications,notificationSnapshot,notificationSnapshot);
  const screen = screenOf(location.pathname);
  const immersive = screen === 'player' || screen === 'widgetPreview';
  const tabIdx = tabOf(screen);
  const isTab = tabIdx >= 0;
  const activeTab = isTab ? tabIdx : p.tab;
  const [today,setToday] = useState(vnToday);
  const [notificationsOpen,setNotificationsOpen] = useState(false);
  useEffect(()=>{
    const refresh=()=>setToday(vnToday());
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  useEffect(() => {
    if (BROWSER_PREVIEW && new URLSearchParams(window.location.search).get('widget') === '1' && location.pathname !== '/widget-preview') {
      navigate('/widget-preview', { replace: true, animate: false });
    }
  }, [location.pathname, navigate]);
  useEffect(()=>{
    void loadNotifications();
    const refresh=()=>void loadNotifications(true);
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[]);
  const currentDate=ymd(today);
  const id = decodeURIComponent(location.pathname.split("/").slice(2).join("/")) || null;
  const notificationContext = useCtx(screen,id);
  const widgetContext = useCtx('today',null);
  const headerTitle=screen==='today' ? `${SHORT_WEEKDAYS[dow(today)]} ${currentDate.d}/${currentDate.m}`
    : screen==='top100' ? `Top ${topLimit('songs',p.periodListSize)} bài All time`
    : screen==='artistsAll' ? `Top ${topLimit('artists',p.periodListSize)} nghệ sĩ All time`
    : screen==='topPlaylists' ? `Top ${topLimit('playlists',p.periodListSize)} playlist All time`
    : screen==='periodTop' && topPeriod(id).kind==='albums' && topPeriod(id).scope==='all' ? `Top ${topLimit('albums',p.periodListSize)} album All time`
    : screen==='periodTop' ? periodTopTitle(id,screenView(p,pathOf(screen,id)).periodFilter) : (DESKTOP_WEB ? desktopPeriodTitle(screen,today) : undefined) || TITLE[screen];
  useEffect(()=>{
    if(screen!=='top100'&&screen!=='artistsAll'&&screen!=='topPlaylists')setP(q=>q.rankFocus?{...q,rankFocus:undefined}:q);
  },[location.key]);

  // Chuyển màn: đóng sheet / toast; lựa chọn biểu đồ được giữ riêng theo màn.
  useEffect(() => {
    setP((q) => ({ ...q, sheet: false, toast: "", findK: null, fq: "", fqd: "", ...(isTab ? { tab: tabIdx } : {}) }));
  }, [location.key]);

  const back = () => {
    const parent = parentPage({ screen, id }, p.tab, p.pageParents);
    navigate(pathOf(DESKTOP_WEB && parent.screen === "overview" ? "overviewThisMonth" : parent.screen, parent.id), { replace: true, animate: false });
  };

  const notify = (message: string) => {
    setP(q=>({...q,ptoast:message}));
    setTimeout(()=>setP(q=>q.ptoast===message?{...q,ptoast:""}:q),2600);
  };
  const minimizing = useRef(false);
  useSwipeBack(location.key, () => {
    if (!isTab) return back();
    if (BROWSER_PREVIEW) return notify("Thu nhỏ app chỉ khả dụng trong Zalo");
    if (IOS_APP) return notify("Đang ở app iOS");
    if (minimizing.current) return;
    minimizing.current=true;
    void minimizeApp().catch(()=>notify("Chưa thu nhỏ được app, hãy thử lại"))
      .finally(()=>{minimizing.current=false;});
  });
  const openTab = (k: number) => {
    setP(q=>({...q,tab:k}));
    if (screen !== TABS[k]) navigate(pathOf(TABS[k]), { replace: true, animate: false });
  };
  const openPlayer = () => {
    setP(q=>({...q,pageParents:rememberParent({screen,id},{screen:'player',id:null},q.tab,q.pageParents)}));
    navigate('/player');
  };
  const openShortcut = (target: QuickShortcut) => {
    const targetId=target.id ? `${target.id}~${today}` : null;
    setQuickMenu(null);
    setP(q=>{
      const targetKey=pathOf(target.screen,targetId);
      const views=target.view ? rememberView(q.views,targetKey,target.view) : q.views;
      if(target.view)saveViews(views);
      return {...q,...target.view,views,pageParents:rememberParent({screen,id},{screen:target.screen,id:targetId},q.tab,q.pageParents)};
    });
    navigate(pathOf(target.screen,targetId));
  };
  const shortcutItems = quickMenu==='overview' ? topShortcuts(p.periodListSize) : quickMenu==='trend' ? TREND_SHORTCUTS : quickMenu==='releases' ? RELEASE_SHORTCUTS : [];

  return (
    <>
      <div className="app-foreground">
      <div className="app-content">
      {!immersive && (DESKTOP_WEB ? <><DesktopNavigation today={today} screen={screen} id={id} open={(s,targetId)=>{const k=TABS.indexOf(s);if(k>=0)openTab(k);else navigate(pathOf(s,targetId));}}/><DesktopHeader title={screen==='today'?`${SHORT_WEEKDAYS[dow(today)]}. ${currentDate.d}/${currentDate.m}/${String(currentDate.y).slice(-2)}`:headerTitle} back={!isTab&&screen!=='releaseYears'&&!WEB_OVERVIEW_SCOPES[screen]?back:undefined} /></> : <Header className={`app-header${screen==='periodTop'?' period-header':''}`} title={headerTitle} showBackIcon={!isTab} onBackClick={back} />)}
      {screen!=='notifications'&&!immersive&&<button type="button" className="notification-bell" aria-label={notifications.unread?`Thông báo, ${notifications.unread} chưa đọc`:'Thông báo'} aria-haspopup={DESKTOP_WEB?"dialog":undefined} aria-expanded={DESKTOP_WEB?notificationsOpen:undefined} onClick={()=>DESKTOP_WEB?setNotificationsOpen(true):navigate('/notifications')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
        {notifications.unread>0&&<span>{notifications.unread>99?'99+':notifications.unread}</span>}
      </button>}
      {DESKTOP_WEB && notificationsOpen && <NotificationsPopup c={notificationContext} close={()=>setNotificationsOpen(false)}/>}
      <AnimationRoutes>
        {ROUTES.map(([path, s]) => (
          <Route key={path} path={path} element={<ScreenPage screen={s} />} />
        ))}
      </AnimationRoutes>
      <WidgetPlaylistDeepLink c={notificationContext}/>
      {IOS_APP&&<NativeWidgetPlaylistData c={widgetContext}/>}
      {(IOS_APP || BROWSER_PREVIEW) && <NativeMiniPlayer hidden={immersive} open={openPlayer} notify={notify}/>}
      {!DESKTOP_WEB && !immersive && <BottomNavigation
        className="app-nav"
        fixed
        activeKey={TABS[activeTab]}
      >
        {TABS.map((t, k) => (
          <BottomNavigation.Item key={t} itemKey={t} onClick={()=>openTab(k)} className="nav-icon-only" label={TAB_LABELS[k]}
            icon={<NavIconWithLongPress screen={t} index={k} openMenu={t==='overview'||t==='trend'||t==='releases'?()=>setQuickMenu(t):undefined}/>} />
        ))}
      </BottomNavigation>}
      {quickMenu&&<QuickShortcutMenu title={quickMenu==='overview'?'Trang Top':quickMenu==='trend'?'Diễn biến':'Sắp ra mắt'} subtitle={quickMenu==='overview'?'Mở nhanh từ Tổng quan':quickMenu==='trend'?'Mở nhanh các tab Diễn biến':'Mở nhanh các tab phát hành'} items={shortcutItems} close={()=>setQuickMenu(null)} open={openShortcut}/>}
      {p.ptoast && <div className="toast"><div>{p.ptoast}</div></div>}
      </div>
      </div>
    </>
  );
}

function NavIconWithLongPress({screen,index,openMenu}:{screen:Screen;index:number;openMenu?:()=>void}) {
  const gesture=useRef<ReturnType<typeof longPress>>();
  const latest=useRef(openMenu); latest.current=openMenu;
  if(!gesture.current)gesture.current=longPress(()=>latest.current?.());
  useEffect(()=>()=>gesture.current?.cancel(),[]);
  const longPressProps = openMenu ? {
    onPointerDown:(event:PointerEvent)=>{if(!event.isPrimary||event.button!==0){gesture.current!.cancel();return;}gesture.current!.start(event.clientX,event.clientY);},
    onPointerMove:(event:PointerEvent)=>gesture.current!.move(event.clientX,event.clientY),
    onPointerUp:()=>gesture.current!.end(),
    onPointerCancel:()=>gesture.current!.cancel(),
    onPointerLeave:()=>gesture.current!.cancel(),
    onClickCapture:(event:MouseEvent)=>{if(gesture.current!.consumeClick()){event.preventDefault();event.stopPropagation();}},
    onContextMenu:(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();gesture.current!.blockClick();openMenu();},
    onKeyDown:(event:KeyboardEvent)=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();openMenu();}},
  } : {};
  const icon=screen === 'playlists' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h10M4 11h10M4 16h7M18 10v8M18 10l3 1M18 18a2.5 2 0 1 1-2.5-2" /></svg> : <Icon icon={TAB_ICONS[index]} />;
  return <span className="nav-longpress-icon" {...longPressProps}>{icon}</span>;
}

function QuickShortcutMenu({title,subtitle,items,close,open}:{title:string;subtitle:string;items:QuickShortcut[];close:()=>void;open:(target:QuickShortcut)=>void}) {
  const panel=useRef<HTMLDivElement>(null);
  const ignoreClicksUntil=useRef(0);
  const actionIntent=useRef(false);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const unlockSelection=lockTextSelection();
    ignoreClicksUntil.current=Date.now()+650;
    panel.current?.focus({preventScroll:true});
    return()=>{unlockSelection();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const actionEvents={
    onPointerDown:(event:PointerEvent)=>{if(event.isPrimary && event.button===0)actionIntent.current=true;},
    onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' ')actionIntent.current=true;},
  };
  const choose=(target:QuickShortcut)=>{
    const intended=actionIntent.current;actionIntent.current=false;
    if(!intended || Date.now()<ignoreClicksUntil.current)return;
    open(target);
  };
  return createPortal(<div className="shortcut-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="shortcut-sheet" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
      <div className="shortcut-handle"/>
      <div className="shortcut-heading shortcut-heading-with-close">
        <div><strong>{title}</strong><span className="t3">{subtitle}</span></div>
        <button type="button" className="shortcut-icon-close" aria-label="Đóng" onClick={close}>×</button>
      </div>
      {items.map(item=><button key={item.label} type="button" {...actionEvents} onClick={()=>choose(item)}>{item.label}<span>{item.icon}</span></button>)}
    </div>
  </div>,document.body);
}

const Layout = () => {
  return (
    <App theme="dark">
      <SnackbarProvider>
        <ZMPRouter memoryRouter={BROWSER_PREVIEW || IOS_APP}>
          <Shell />
        </ZMPRouter>
      </SnackbarProvider>
    </App>
  );
};
export default Layout;
