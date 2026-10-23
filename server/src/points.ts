// Artist points "Điểm" (Lark "R ALL Artist data": R ALL (pt), R ALL). Every relative part compares
// the artist only with the other artists in the scored set (settings "r_all_artists", Lark's
// hand-picked list).
//   RA AT        rated tracks / tracks + rating sum / rated tracks + rated tracks / 5
//                (rated = rating > 0 and not "Stop rating"; the sum includes every rating)
//   R AT         artists in the set ranked lower all-time (by hours) / 3
//   R AT T04/24  artists in the set ranked lower since 04/2024 / 2; an artist with no rank there
//                (every logged play excluded) scores 0
//   PT WW/MM/YY  artists in the set with fewer (but some) week / month / year points, counting only
//                artists that have an R AT T04/24 rank (Lark counts that column)
//     week points  = weeks at artist top 1 + Σ songs' weeks at top 1 / 3 + Σ albums' weeks at top 1 / 2
//     month points = artist top 1/2/3 × 3/2/1 + months with 50+ plays + (songs × 3/2/1) / 3 + (albums × 3/2/1) / 2
//     year points  = artist top 1/2/3 × 5/3/1 + (songs × 5/3/1) / 3 + (albums × 5/3/1) / 2
//   R Album      albums in the all-time album top 30
//   R Song       songs in the all-time song top 100 (MONO: songs over 6 h with no excluded logged play)
//   R ALL (pt)   sum of the above; R ALL = rank by points, ties broken by R AT
import type { Env } from "./index";
import { ALBUM_AT_SQL } from "./albumRank";
import { artistRanks, ratingsByTrack, songsAt } from "./memos";
import { EXCLUDED_PLAY_SQL } from "./periodRank";


export interface ArtistPoints {
  rank: number;
  artist: string;
  points: number;
  parts: {
    ratingAT: number; rAT: number; rFT0424: number;
    ptWW: number; ptMM: number; ptYY: number; rAlbum: number; rSong: number;
  };
  raw: {
    atRank: number | null; ft0424Rank: number | null; weekPoints: number; monthPoints: number; yearPoints: number;
    tracks: number; ratedTracks: number; ratingSum: number;
  };
}

export async function artistPoints(env: Env, asOf: string): Promise<{ artists: string[]; rows: ArtistPoints[] }> {
  const db = env.DB;
  const set = await db.prepare("SELECT value FROM settings WHERE key = 'r_all_artists'").first<{ value: string }>();
  const artists: string[] = set ? JSON.parse(set.value) : [];
  if (!artists.length) return { artists, rows: [] };

  const res = await db.batch<any>([
    // MONO's R Song: tracks over 6 h all-time with no excluded logged play (Lark "EXCLUDE (OG)" = 0;
    // a track with no logged play counts too, as Lark reads the blank as 0)
    db.prepare(
      `WITH s AS (SELECT track_id, COUNT(*) AS n FROM plays
                  WHERE track_id IS NOT NULL AND play_date >= ?2 AND play_date <= ?1 GROUP BY track_id)
       SELECT COUNT(*) AS n FROM tracks t LEFT JOIN s ON s.track_id = t.id
       WHERE t.album_artist = 'MONO'
         AND COALESCE(t.duration_s, 0) * (t.plays_to_12_2024 + COALESCE(s.n, 0)) / 60.0 > 360
         AND NOT EXISTS (SELECT 1 FROM plays p WHERE p.track_id = t.id AND p.play_date <= ?1
                         AND COALESCE(${EXCLUDED_PLAY_SQL}, 0) = 1)`,
    ).bind(asOf, env.LASTFM_FROM),
    db.prepare("SELECT id, album_artist, COALESCE(comments, '') AS comments FROM tracks"),
    db.prepare(`SELECT album_artist AS artist, COUNT(*) AS n FROM (${ALBUM_AT_SQL}) WHERE rank <= 30 GROUP BY album_artist`)
      .bind(asOf, env.LASTFM_FROM),
    db.prepare(
      `SELECT owner AS artist, kind, SUM(w * f) AS pts FROM (
         SELECT CASE b.slot WHEN 'song' THEN t.album_artist
                            WHEN 'album' THEN substr(b.entity, 1, instr(b.entity, char(31)) - 1)
                            ELSE b.entity END AS owner,
                bp.kind,
                CASE WHEN b.slot = 'pc50' THEN 1
                     WHEN bp.kind = 'ww' THEN b.pos = 1
                     WHEN bp.kind = 'mm' THEN 4 - b.pos
                     ELSE CASE b.pos WHEN 1 THEN 5 WHEN 2 THEN 3 ELSE 1 END END AS w,
                CASE b.slot WHEN 'song' THEN 1 / 3.0 WHEN 'album' THEN 0.5 ELSE 1 END AS f
         FROM board b JOIN board_periods bp ON bp.period = b.period
         LEFT JOIN tracks t ON b.slot = 'song' AND t.id = b.entity
         WHERE bp.to_date <= ?1)
       GROUP BY owner, kind`,
    ).bind(asOf),
  ]);

  const [ranks, songsChart, ratings] = await Promise.all([artistRanks(env, asOf), songsAt(env, asOf), ratingsByTrack(env, asOf)]);
  const byArtist = <T>(rows: any[], f: (r: any) => T) => new Map<string, T>(rows.map((r) => [r.artist, f(r)]));
  const atRank = new Map([...ranks.at].map(([a, r]) => [a, r.rank]));
  const ftRank = new Map([...ranks.ft0424].map(([a, r]) => [a, r.rank]));
  const monoSongs: number = res[0].results[0]?.n ?? 0;
  // tracks, rated tracks (rating > 0 and not "Stop rating") and rating sum per album artist
  const lib = new Map<string, { tracks: number; rated: number; rating_sum: number }>();
  for (const t of res[1].results) {
    const l = lib.get(t.album_artist) ?? { tracks: 0, rated: 0, rating_sum: 0 };
    const rating = ratings.get(t.id)?.rating ?? 0;
    l.tracks++;
    if (rating > 0 && !t.comments.includes("Stop rating")) l.rated++;
    l.rating_sum += rating;
    lib.set(t.album_artist, l);
  }
  const songs = new Map<string, { top100: number }>();
  for (const s of songsChart) if (s.rank <= 100 && s.artist) songs.set(s.artist, { top100: (songs.get(s.artist)?.top100 ?? 0) + 1 });
  const albums = byArtist(res[2].results, (r) => r.n as number);
  const pts = new Map<string, { ww: number; mm: number; yy: number }>();
  for (const r of res[3].results) {
    const p = pts.get(r.artist) ?? { ww: 0, mm: 0, yy: 0 };
    p[r.kind as "ww" | "mm" | "yy"] = r.pts;
    pts.set(r.artist, p);
  }

  const base = artists.map((artist) => {
    const l = lib.get(artist) ?? { tracks: 0, rated: 0, rating_sum: 0 };
    const p = pts.get(artist) ?? { ww: 0, mm: 0, yy: 0 };
    const s = songs.get(artist);
    return {
      artist,
      at: atRank.get(artist) ?? null,
      ft: ftRank.get(artist) ?? null,
      p,
      tracks: l.tracks, rated: l.rated, ratingSum: l.rating_sum,
      ratingAT: (l.tracks ? l.rated / l.tracks : 0) + (l.rated ? l.rating_sum / l.rated : 0) + l.rated / 5,
      rAlbum: albums.get(artist) ?? 0,
      rSong: artist === "MONO" ? monoSongs : s?.top100 ?? 0,
    };
  });
  const ranked = base.filter((b) => b.ft !== null);
  const pt = (own: number, k: "ww" | "mm" | "yy") => ranked.filter((o) => o.p[k] > 0 && o.p[k] < own).length;

  const rows = base.map((b) => {
    const parts = {
      ratingAT: b.ratingAT,
      rAT: b.at === null ? 0 : base.filter((o) => o.at !== null && o.at > b.at!).length / 3,
      rFT0424: b.ft === null ? 0 : base.filter((o) => o.ft !== null && o.ft > b.ft!).length / 2,
      ptWW: pt(b.p.ww, "ww"),
      ptMM: pt(b.p.mm, "mm"),
      ptYY: pt(b.p.yy, "yy"),
      rAlbum: b.rAlbum,
      rSong: b.rSong,
    };
    return {
      rank: 0,
      artist: b.artist,
      points: Object.values(parts).reduce((a, v) => a + v, 0),
      parts,
      raw: { atRank: b.at, ft0424Rank: b.ft, weekPoints: b.p.ww, monthPoints: b.p.mm, yearPoints: b.p.yy,
             tracks: b.tracks, ratedTracks: b.rated, ratingSum: b.ratingSum },
    };
  });
  for (const r of rows) {
    r.rank = 1 + rows.filter((o) => o.points > r.points + 1e-9
      || (Math.abs(o.points - r.points) <= 1e-9 && o.parts.rAT > r.parts.rAT + 1e-9)).length;
  }
  rows.sort((a, b) => a.rank - b.rank);
  return { artists, rows };
}
