// Fetches players who are eligible to fill a sub request using SQL,
// based on position, team membership, game conflicts, and availability.

import type { Db } from "./db.js";
import { LEAGUE_TIME_ZONE, type Position } from "./domain.js";
import type { Candidate } from "./ranking.js";

/**
 * Players who could fill a sub request. A player is eligible when they:
 *
 * - play the position (as their main one or one of their others)
 * - are not on either team in the game
 * - are not playing for their own team in a game at an overlapping time
 * - have not already claimed a spot in a game at an overlapping time
 *   (this includes the same game)
 * - have an availability window on that weekday that covers the whole game,
 *   in league-local time. Games that cross midnight match no window.
 *
 * Ranking happens afterwards in `rankCandidates`.
 */
const ELIGIBLE_SQL = `
WITH req AS (
  SELECT sr.position, g.id AS game_id, g.home_team_id, g.away_team_id,
         g.starts_at, g.ends_at,
         g.starts_at AT TIME ZONE $2 AS local_start,
         g.ends_at   AT TIME ZONE $2 AS local_end
  FROM sub_requests sr
  JOIN games g ON g.id = sr.game_id
  WHERE sr.id = $1
)
SELECT p.id AS "playerId",
       p.name,
       p.primary_position AS "primaryPosition",
       p.other_positions::text[] AS "otherPositions",
       (SELECT count(*)::int FROM claims c
          WHERE c.player_id = p.id
            AND c.claimed_at > now() - interval '30 days') AS "recentSubs"
FROM players p
CROSS JOIN req
WHERE (p.primary_position = req.position OR req.position = ANY (p.other_positions))
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.player_id = p.id
      AND tm.team_id IN (req.home_team_id, req.away_team_id))
  AND NOT EXISTS (
    SELECT 1 FROM games g2
    JOIN team_members tm2 ON tm2.team_id IN (g2.home_team_id, g2.away_team_id)
    WHERE tm2.player_id = p.id
      AND g2.starts_at < req.ends_at AND g2.ends_at > req.starts_at)
  AND NOT EXISTS (
    SELECT 1 FROM claims c3
    JOIN games g3 ON g3.id = c3.game_id
    WHERE c3.player_id = p.id
      AND g3.starts_at < req.ends_at AND g3.ends_at > req.starts_at)
  AND EXISTS (
    SELECT 1 FROM availability a
    WHERE a.player_id = p.id
      AND a.day_of_week = extract(dow FROM req.local_start)
      AND req.local_start::date = req.local_end::date
      AND a.start_time <= req.local_start::time
      AND a.end_time   >= req.local_end::time)
`;

export async function findEligibleCandidates(
  db: Db,
  subRequestId: number,
): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate & { otherPositions: Position[] }>(
    ELIGIBLE_SQL,
    [subRequestId, LEAGUE_TIME_ZONE],
  );
  return rows;
}
