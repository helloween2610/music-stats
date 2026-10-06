import {screenView, rememberView, saveViews} from '@/lib/view-preferences';
import {MetadataHelpProvider} from './metadata-help';
import { AlbumScreen } from '@/screens/album';
import { ShortcutProvider } from './shortcuts';
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dow, vnToday, ymd } from '@/lib/fmt';
import { useAtom } from "jotai";
import {
  AnimationRoutes, App, BottomNavigation, Header, Icon, Page, Route, SnackbarProvider, ZMPRouter,
  useLocation, useNavigate, useParams,
} from "zmp-ui";
import { minimizeApp } from "zmp-sdk/apis";
import { periodTopTitle } from "@/lib/period-top";
import { useSwipeBack } from "./swipe-back";
import { BROWSER_PREVIEW, DESKTOP_WEB } from "@/config";
import { parentPage, rememberParent } from "@/lib/navigation";

import { invalidate, useApiRefresh, useServerUpdates } from "@/lib/api";
import { PullRefresh } from './pull-refresh';
import { LIBREQ } from "@/lib/sync";
import { pathOf, Screen, TAB_ICONS, TAB_LABELS, TABS, tabOf, TITLE, uiAtom, UI, WEB_OVERVIEW_SCOPES } from "@/state";
import { buildVM, Ctx } from "@/vm";
import { ScopeTabs, EmptyState, LoadingView } from "./ui";
import { FindSheet, ShareSheet } from "./sheets";
import { ArtistsAllScreen, RecentScreen, PeriodTopScreen, OverviewScreen, RisingScreen, Top100Screen, TodayScreen, TrendScreen } from "@/screens/main";
import { ArtistScreen, LibraryScreen, RulesScreen, SongScreen, UnmatchedScreen } from "@/screens/detail";

import { ReleasesScreen } from "@/screens/discovery";

import { PlaylistsScreen, PlaylistScreen } from "@/screens/playlists";
import { NotificationsPopup, NotificationsScreen } from "@/screens/notifications";
import { loadNotifications, notificationSnapshot, subscribeNotifications } from "@/lib/notifications";

import { DesktopTodayScreen, DesktopOverviewScreen, DesktopTrendScreen, DesktopReleaseYearsScreen } from "@/screens/desktop";
import { DesktopNavigation, DesktopHeader, desktopPeriodTitle } from "./desktop-shell";

const SCREENS: Record<Screen, (x: any) => JSX.Element> = {
  album: AlbumScreen, recent: RecentScreen, playlists: PlaylistsScreen, playlist: PlaylistScreen,
  periodTop: PeriodTopScreen, today: TodayScreen, top100: Top100Screen, artistsAll: ArtistsAllScreen, trend: TrendScreen,
  overview: OverviewScreen, releases: ReleasesScreen, library: LibraryScreen, unmatched: UnmatchedScreen, rules: RulesScreen, rising: RisingScreen, song: SongScreen, artist: ArtistScreen,
  notifications: NotificationsScreen, releaseYears: DesktopReleaseYearsScreen,
  overviewLastMonth: DesktopOverviewScreen, overviewThisMonth: DesktopOverviewScreen,
  overviewThisYear: DesktopOverviewScreen, overviewAllTime: DesktopOverviewScreen,
};

const ROUTES: [string, Screen][] = [
  ["/", "today"], ["/trend", "trend"], ["/overview", "overview"], ["/releases", "releases"], ["/library", "library"],
  ["/notifications", "notifications"],
  ["/recent", "recent"], ["/playlists", "playlists"], ["/playlists/:id", "playlists"], ["/playlist/:id", "playlist"],
  ["/period-top/:id", "periodTop"], ["/top100", "top100"], ["/artists", "artistsAll"], ["/unmatched", "unmatched"], ["/rules", "rules"], ["/rising", "rising"], ["/album/:id", "album"], ["/song/:id", "song"], ["/artist/:id", "artist"],
];

if (DESKTOP_WEB) ROUTES.push(["/release-years", "releaseYears"],
  ["/last-month", "overviewLastMonth"], ["/this-month", "overviewThisMonth"],
  ["/this-year", "overviewThisYear"], ["/all-time", "overviewAllTime"]);

const screenOf = (pathname: string): Screen => {
  const seg = pathname.split("/")[1] || "";
  const hit = ROUTES.find(([path]) => path.split("/")[1] === seg);
  return hit ? hit[1] : "today";
};
const SHORT_WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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
  const vm = screen === 'notifications' ? null : buildVM(fixedScope ? {...c,screen:'overview',p:{...c.p,scope:fixedScope}} : c);
  const View = DESKTOP_WEB ? ({today: DesktopTodayScreen, overview: DesktopOverviewScreen, trend: DesktopTrendScreen}[screen] || SCREENS[screen]) : SCREENS[screen];
  useEffect(() => {
    if (screen !== "library") return;
    LIBREQ.screenOpen = true;
    return () => { LIBREQ.screenOpen = false; };
  }, [screen]);
  return (
    <MetadataHelpProvider screenKey={pathOf(screen,c.id)}><ShortcutProvider c={c}><Page className={`sc screen-${screen}`} hideScrollbar restoreScrollOnBack>
      <PullRefresh notify={c.ptoast} />
      {screen === 'notifications' ? <View c={c} vm={{}} /> : <>
      {!DESKTOP_WEB && screen === "overview" && (vm!.isLoading || vm!.unavailable) && <ScopeTabs items={vm!.scopeChips} />}
      {vm!.isLoading ? <LoadingView /> : vm!.unavailable ? (
        <EmptyState title="Chưa có dữ liệu" note={vm!.unavailable}
          action={{ label: "Thử lại", onTap: () => invalidate(() => true) }} />
      ) : <View vm={vm!} c={c} />}
      {!vm!.isLoading && !vm!.unavailable && (screen === "song" || screen === "artist") && <ShareSheet vm={vm!} c={c} />}
      {!vm!.isLoading && !vm!.unavailable && (screen === "library" || screen === "unmatched") && <FindSheet vm={vm!} c={c} />}
      </>}
    </Page></ShortcutProvider></MetadataHelpProvider>
  );
}

function Shell() {
  useServerUpdates();
  const location = useLocation();
  const navigate = useNavigate();
  const [p, setP] = useAtom(uiAtom);
  const notifications=useSyncExternalStore(subscribeNotifications,notificationSnapshot,notificationSnapshot);
  const screen = screenOf(location.pathname);
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
  useEffect(()=>{
    void loadNotifications();
    const refresh=()=>void loadNotifications(true);
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[]);
  const currentDate=ymd(today);
  const id = decodeURIComponent(location.pathname.split("/").slice(2).join("/")) || null;
  const notificationContext = useCtx(screen,id);
  const headerTitle=screen==='today' ? `${SHORT_WEEKDAYS[dow(today)]} ${currentDate.d}/${currentDate.m}`
    : screen==='periodTop' ? periodTopTitle(id,screenView(p,pathOf(screen,id)).periodFilter) : (DESKTOP_WEB ? desktopPeriodTitle(screen,today) : undefined) || TITLE[screen];
  useEffect(()=>{
    if(screen!=='top100'&&screen!=='artistsAll')setP(q=>q.rankFocus?{...q,rankFocus:undefined}:q);
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
    if (minimizing.current) return;
    minimizing.current=true;
    void minimizeApp().catch(()=>notify("Chưa thu nhỏ được app, hãy thử lại"))
      .finally(()=>{minimizing.current=false;});
  });
  const openTab = (k: number) => {
    setP(q=>({...q,tab:k}));
    if (screen !== TABS[k]) navigate(pathOf(TABS[k]), { replace: true, animate: false });
  };

  return (
    <>
      {DESKTOP_WEB ? <><DesktopNavigation today={today} screen={screen} id={id} open={(s,targetId)=>{const k=TABS.indexOf(s);if(k>=0)openTab(k);else navigate(pathOf(s,targetId));}}/><DesktopHeader title={screen==='today'?`${SHORT_WEEKDAYS[dow(today)]}. ${currentDate.d}/${currentDate.m}/${String(currentDate.y).slice(-2)}`:headerTitle} back={!isTab&&screen!=='releaseYears'&&!WEB_OVERVIEW_SCOPES[screen]?back:undefined} /></> : <Header className={`app-header${screen==='periodTop'?' period-header':''}`} title={headerTitle} showBackIcon={!isTab} onBackClick={back} />}
      {screen!=='notifications'&&<button type="button" className="notification-bell" aria-label={notifications.unread?`Thông báo, ${notifications.unread} chưa đọc`:'Thông báo'} aria-haspopup={DESKTOP_WEB?"dialog":undefined} aria-expanded={DESKTOP_WEB?notificationsOpen:undefined} onClick={()=>DESKTOP_WEB?setNotificationsOpen(true):navigate('/notifications')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
        {notifications.unread>0&&<span>{notifications.unread>99?'99+':notifications.unread}</span>}
      </button>}
      {DESKTOP_WEB && notificationsOpen && <NotificationsPopup c={notificationContext} close={()=>setNotificationsOpen(false)}/>}
      <AnimationRoutes>
        {ROUTES.map(([path, s]) => (
          <Route key={path} path={path} element={<ScreenPage screen={s} />} />
        ))}
      </AnimationRoutes>
      {!DESKTOP_WEB && <BottomNavigation
        className="app-nav"
        fixed
        activeKey={TABS[activeTab]}
      >
        {TABS.map((t, k) => (
          <BottomNavigation.Item key={t} itemKey={t} onClick={()=>openTab(k)} className="nav-icon-only" label={TAB_LABELS[k]} icon={t === 'overview' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 16v-4m5 4V8m5 8V5" /></svg> : <Icon icon={TAB_ICONS[k]} />} />
        ))}
      </BottomNavigation>}
      {p.ptoast && <div className="toast"><div>{p.ptoast}</div></div>}
    </>
  );
}

const Layout = () => {
  return (
    <App theme="dark">
      <SnackbarProvider>
        <ZMPRouter memoryRouter={BROWSER_PREVIEW}>
          <Shell />
        </ZMPRouter>
      </SnackbarProvider>
    </App>
  );
};
export default Layout;
