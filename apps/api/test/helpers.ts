import { createPool, type Db } from "../src/db.js";
import { LEAGUE_TIME_ZONE } from "../src/domain.js";
import { testDatabaseUrl } from "./global-setup.js";

export function testPool(): Db {
  return createPool(testDatabaseUrl());
}

export async function resetDb(db: Db): Promise<void> {
  await db.query(
    `TRUNCATE claims, sub_requests, availability, games, team_members, teams, leagues, players
     RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;

export async function makePlayer(
  db: Db,
  position = "outside",
  others: string[] = [],
  name?: string,
): Promise<number> {
  counter += 1;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO players (name, email, primary_position, other_positions)
     VALUES ($1, $2, $3, $4::court_position[]) RETURNING id`,
    [
      name ?? `Player ${counter}`,
      `player${counter}@example.com`,
      position,
      others,
    ],
  );
  return rows[0]!.id;
}

export async function addMember(db: Db, teamId: number, playerId: number) {
  await db.query(
    `INSERT INTO team_members (team_id, player_id) VALUES ($1, $2)`,
    [teamId, playerId],
  );
}

export interface GameTime {
  /** Weeks from the current week. 1 = next week, -1 = last week. */
  weeksAhead?: number;
  /** Days after Monday: 0 = Monday, 1 = Tuesday, … */
  dayOffset?: number;
  /** Local start time in the league's time zone, "HH:MM". */
  start?: string;
  durationMinutes?: number;
}

/**
 * A game at a fixed local time relative to today, so tests never go stale.
 * Default: next week's Tuesday, 20:00–21:00 Toronto time.
 */
export async function insertGame(
  db: Db,
  leagueId: number,
  homeTeamId: number,
  awayTeamId: number,
  {
    weeksAhead = 1,
    dayOffset = 1,
    start = "20:00",
    durationMinutes = 60,
  }: GameTime = {},
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `WITH t AS (
       SELECT (date_trunc('week', now() AT TIME ZONE $4)
               + make_interval(weeks => $5, days => $6)
               + $7::time) AT TIME ZONE $4 AS starts_at
     )
     INSERT INTO games (league_id, home_team_id, away_team_id, starts_at, ends_at)
     SELECT $1, $2, $3, t.starts_at, t.starts_at + make_interval(mins => $8) FROM t
     RETURNING id`,
    [
      leagueId,
      homeTeamId,
      awayTeamId,
      LEAGUE_TIME_ZONE,
      weeksAhead,
      dayOffset,
      start,
      durationMinutes,
    ],
  );
  return rows[0]!.id;
}

/** A league with two teams (captains are members) and one game. */
export async function makeGame(db: Db, time: GameTime = {}) {
  const captainA = await makePlayer(db, "setter");
  const captainB = await makePlayer(db, "setter");
  const { rows: l } = await db.query<{ id: number }>(
    `INSERT INTO leagues (name, venue, level) VALUES ($1, 'Test Gym', 'Rec') RETURNING id`,
    [`Test League ${captainA}`],
  );
  const leagueId = l[0]!.id;
  const team = async (name: string, captain: number) => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO teams (league_id, name, captain_id) VALUES ($1, $2, $3) RETURNING id`,
      [leagueId, name, captain],
    );
    const teamId = rows[0]!.id;
    await addMember(db, teamId, captain);
    return teamId;
  };
  const homeTeamId = await team("Home", captainA);
  const awayTeamId = await team("Away", captainB);
  const gameId = await insertGame(db, leagueId, homeTeamId, awayTeamId, time);
  return { leagueId, homeTeamId, awayTeamId, captainA, captainB, gameId };
}

export async function makeRequest(
  db: Db,
  gameId: number,
  teamId: number,
  requestedBy: number,
  position = "setter",
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO sub_requests (game_id, team_id, position, requested_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [gameId, teamId, position, requestedBy],
  );
  return rows[0]!.id;
}

export async function setAvailability(
  db: Db,
  playerId: number,
  dayOfWeek: number,
  startTime = "18:00",
  endTime = "23:00",
) {
  await db.query(
    `INSERT INTO availability (player_id, day_of_week, start_time, end_time)
     VALUES ($1, $2, $3, $4)`,
    [playerId, dayOfWeek, startTime, endTime],
  );
}

export async function makeClaim(
  db: Db,
  subRequestId: number,
  gameId: number,
  playerId: number,
  claimedAt: Date | null = null,
) {
  await db.query(
    `INSERT INTO claims (sub_request_id, game_id, player_id, claimed_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))`,
    [subRequestId, gameId, playerId, claimedAt],
  );
}
