import { pathOf, Screen, TABS, WEB_OVERVIEW_SCOPES } from "@/state";

export type PageTarget = { screen: Screen; id?: string | null };
export type PageParents = Record<string, PageTarget>;

// Back follows page hierarchy. Filters and sibling detail pages never add levels.
export function parentPage(page: PageTarget, tab: number, parents: PageParents): PageTarget {
  switch (page.screen) {
    case "recent": return { screen: "today" };
    case "periodTop": return parents[pathOf(page.screen,page.id)] || { screen: page.id?.startsWith("monthSongs~") ? "today" : "overview" };
    case "top100": case "artistsAll": case "topPlaylists": return parents[pathOf(page.screen,page.id)] || { screen: "overview" };
    case "rising": return { screen: "trend" };
    case "playlist": return parents[pathOf(page.screen,page.id)] || { screen: "playlists" };
    case "playlists": case "rules": case "unmatched": return { screen: "library" };
    case "song": case "artist": case "album": return parents[pathOf(page.screen, page.id)] || { screen: TABS[tab] || "today" };
    default: return { screen: TABS[tab] || "today" };
  }
}

export function rememberParent(from: PageTarget, to: PageTarget, tab: number, parents: PageParents): PageParents {
  if (WEB_OVERVIEW_SCOPES[from.screen] && ["periodTop","top100","artistsAll","topPlaylists"].includes(to.screen)) return {...parents,[pathOf(to.screen,to.id)]:from};
  if (to.screen !== "playlist" && to.screen !== "song" && to.screen !== "artist" && to.screen !== "album") return parents;
  const detail = ["song", "artist", "album"].includes(from.screen);
  let parent = from.screen === "album" && to.screen === "song" ? from : detail ? parentPage(from, tab, parents) : from;
  // A song's album link may return to its parent album; never make that album its own parent.
  if(pathOf(parent.screen,parent.id)===pathOf(to.screen,to.id))parent=parentPage(parent,tab,parents);
  return { ...parents, [pathOf(to.screen, to.id)]: parent };
}
