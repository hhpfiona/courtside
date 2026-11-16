import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  makeGame,
  makePlayer,
  makeRequest,
  resetDb,
  testPool,
} from "./helpers.js";

const db = testPool();

beforeEach(() => resetDb(db));
afterAll(() => db.end());

/** Postgres error codes we expect constraints to raise. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

describe("claims: double-booking backstops", () => {
  it("allows only one claim per sub request", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const requestId = await makeRequest(db, gameId, homeTeamId, captainA);
    const [sub1, sub2] = [await makePlayer(db), await makePlayer(db)];

    await db.query(
      `INSERT INTO claims (sub_request_id, game_id, player_id) VALUES ($1, $2, $3)`,
      [requestId, gameId, sub1],
    );
    await expect(
      db.query(
        `INSERT INTO claims (sub_request_id, game_id, player_id) VALUES ($1, $2, $3)`,
        [requestId, gameId, sub2],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("stops one player from claiming two spots in the same game", async () => {
    const { gameId, homeTeamId, awayTeamId, captainA, captainB } =
      await makeGame(db);
    const homeRequest = await makeRequest(db, gameId, homeTeamId, captainA);
    const awayRequest = await makeRequest(db, gameId, awayTeamId, captainB);
    const sub = await makePlayer(db);

    await db.query(
      `INSERT INTO claims (sub_request_id, game_id, player_id) VALUES ($1, $2, $3)`,
      [homeRequest, gameId, sub],
    );
    await expect(
      db.query(
        `INSERT INTO claims (sub_request_id, game_id, player_id) VALUES ($1, $2, $3)`,
        [awayRequest, gameId, sub],
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("rejects a claim whose game does not match its request's game", async () => {
    const first = await makeGame(db);
    const second = await makeGame(db);
    const requestId = await makeRequest(
      db,
      first.gameId,
      first.homeTeamId,
      first.captainA,
    );
    const sub = await makePlayer(db);

    await expect(
      db.query(
        `INSERT INTO claims (sub_request_id, game_id, player_id) VALUES ($1, $2, $3)`,
        [requestId, second.gameId, sub],
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});

describe("data sanity checks", () => {
  it("rejects a game where a team plays itself", async () => {
    const { leagueId, homeTeamId } = await makeGame(db);
    await expect(
      db.query(
        `INSERT INTO games (league_id, home_team_id, away_team_id, starts_at, ends_at)
         VALUES ($1, $2, $2, '2026-12-02 20:00-05', '2026-12-02 21:00-05')`,
        [leagueId, homeTeamId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("rejects a game that ends before it starts", async () => {
    const { leagueId, homeTeamId, awayTeamId } = await makeGame(db);
    await expect(
      db.query(
        `INSERT INTO games (league_id, home_team_id, away_team_id, starts_at, ends_at)
         VALUES ($1, $2, $3, '2026-12-02 21:00-05', '2026-12-02 20:00-05')`,
        [leagueId, homeTeamId, awayTeamId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("rejects an availability window that ends before it starts", async () => {
    const player = await makePlayer(db);
    await expect(
      db.query(
        `INSERT INTO availability (player_id, day_of_week, start_time, end_time)
         VALUES ($1, 2, '21:00', '19:00')`,
        [player],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("rejects a day of week outside 0–6", async () => {
    const player = await makePlayer(db);
    await expect(
      db.query(
        `INSERT INTO availability (player_id, day_of_week, start_time, end_time)
         VALUES ($1, 7, '18:00', '22:00')`,
        [player],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("rejects listing the primary position again under other positions", async () => {
    await expect(
      makePlayer(db, "setter", ["setter", "opposite"]),
    ).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it("rejects duplicate player emails", async () => {
    await db.query(
      `INSERT INTO players (name, email, primary_position) VALUES ('A', 'same@example.com', 'libero')`,
    );
    await expect(
      db.query(
        `INSERT INTO players (name, email, primary_position) VALUES ('B', 'same@example.com', 'middle')`,
      ),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});
