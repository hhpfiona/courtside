import { createPool, type Db } from "../src/db.js";
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

let emailCounter = 0;

export async function makePlayer(
  db: Db,
  position = "outside",
  others: string[] = [],
): Promise<number> {
  emailCounter += 1;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO players (name, email, primary_position, other_positions)
     VALUES ($1, $2, $3, $4::court_position[]) RETURNING id`,
    [
      `Player ${emailCounter}`,
      `player${emailCounter}@example.com`,
      position,
      others,
    ],
  );
  return rows[0]!.id;
}

/** A league with two teams and one game; returns the ids a test needs. */
export async function makeGame(db: Db) {
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
    return rows[0]!.id;
  };
  const homeTeamId = await team("Home", captainA);
  const awayTeamId = await team("Away", captainB);
  const { rows: g } = await db.query<{ id: number }>(
    `INSERT INTO games (league_id, home_team_id, away_team_id, starts_at, ends_at)
     VALUES ($1, $2, $3, '2026-12-01 20:00-05', '2026-12-01 21:00-05') RETURNING id`,
    [leagueId, homeTeamId, awayTeamId],
  );
  return {
    leagueId,
    homeTeamId,
    awayTeamId,
    captainA,
    captainB,
    gameId: g[0]!.id,
  };
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
