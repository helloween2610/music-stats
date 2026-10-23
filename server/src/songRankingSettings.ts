import type { Env } from "./index";

export const SONG_RANKING_WEIGHTS = [0.7, 0.8, 0.9, 1] as const;

export function isSongRankingWeight(value: number): value is (typeof SONG_RANKING_WEIGHTS)[number] {
  return SONG_RANKING_WEIGHTS.includes(value as (typeof SONG_RANKING_WEIGHTS)[number]);
}

export async function getSongRankingWeight(env: Env, trackId: string) {
  if (!trackId) return null;
  return env.DB.prepare("SELECT id AS track_id, COALESCE(rank_weight_custom, rank_weight, 1) AS weight FROM tracks WHERE id = ?1")
    .bind(trackId)
    .first<{ track_id: string; weight: number }>();
}

export async function saveSongRankingWeight(env: Env, trackId: string, weight: number) {
  if (!trackId) return null;
  if (!isSongRankingWeight(weight)) return null;
  return env.DB.prepare(
    `UPDATE tracks SET rank_weight_custom = ?2, updated_at = datetime('now')
     WHERE id = ?1 RETURNING id AS track_id, COALESCE(rank_weight_custom, rank_weight, 1) AS weight`,
  ).bind(trackId, weight).first<{ track_id: string; weight: number }>();
}
