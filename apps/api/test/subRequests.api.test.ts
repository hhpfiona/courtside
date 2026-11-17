import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  makeClaim,
  makeGame,
  makePlayer,
  makeRequest,
  resetDb,
  setAvailability,
  testPool,
} from "./helpers.js";

const db = testPool();
const app = buildApp(db);
beforeEach(() => resetDb(db));
afterAll(async () => {
  await app.close();
  await db.end();
});

const TUESDAY = 2;

describe("POST /games/:gameId/sub-requests", () => {
  const post = (gameId: number, payload: object) =>
    app.inject({
      method: "POST",
      url: `/games/${gameId}/sub-requests`,
      payload,
    });

  it("lets a captain ask for a sub", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const res = await post(gameId, {
      teamId: homeTeamId,
      position: "middle",
      requestedBy: captainA,
      note: "Regular is away",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: expect.any(Number),
      gameId,
      teamId: homeTeamId,
      teamName: "Home",
      position: "middle",
      status: "open",
      note: "Regular is away",
      requestedBy: captainA,
    });
  });

  it("returns 404 for a game that does not exist", async () => {
    const { homeTeamId, captainA } = await makeGame(db);
    const res = await post(999, {
      teamId: homeTeamId,
      position: "setter",
      requestedBy: captainA,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a team that is not in the game", async () => {
    const game = await makeGame(db);
    const other = await makeGame(db);
    const res = await post(game.gameId, {
      teamId: other.homeTeamId,
      position: "setter",
      requestedBy: other.captainA,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "team_not_in_game" });
  });

  it("only lets that team's captain ask", async () => {
    const { gameId, homeTeamId, captainB } = await makeGame(db);
    const res = await post(gameId, {
      teamId: homeTeamId,
      position: "setter",
      requestedBy: captainB,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "not_captain" });
  });

  it("rejects requests for a game that has already started", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db, {
      weeksAhead: -1,
    });
    const res = await post(gameId, {
      teamId: homeTeamId,
      position: "setter",
      requestedBy: captainA,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "game_started" });
  });

  it("rejects an unknown position", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const res = await post(gameId, {
      teamId: homeTeamId,
      position: "goalie",
      requestedBy: captainA,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /sub-requests", () => {
  it("lists upcoming open requests, soonest first", async () => {
    const later = await makeGame(db, { weeksAhead: 2 });
    const sooner = await makeGame(db, { weeksAhead: 1 });
    const past = await makeGame(db, { weeksAhead: -1 });
    const laterId = await makeRequest(
      db,
      later.gameId,
      later.homeTeamId,
      later.captainA,
    );
    const soonerId = await makeRequest(
      db,
      sooner.gameId,
      sooner.homeTeamId,
      sooner.captainA,
    );
    await makeRequest(db, past.gameId, past.homeTeamId, past.captainA);

    const res = await app.inject({ method: "GET", url: "/sub-requests" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { id: number }) => r.id)).toEqual([
      soonerId,
      laterId,
    ]);
  });

  it("filters by status", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const id = await makeRequest(db, gameId, homeTeamId, captainA);
    await db.query(`UPDATE sub_requests SET status = 'filled' WHERE id = $1`, [
      id,
    ]);

    const open = await app.inject({ method: "GET", url: "/sub-requests" });
    const filled = await app.inject({
      method: "GET",
      url: "/sub-requests?status=filled",
    });
    expect(open.json()).toEqual([]);
    expect(filled.json().map((r: { id: number }) => r.id)).toEqual([id]);
  });

  it("rejects an unknown status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/sub-requests?status=maybe",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /sub-requests/:id/candidates", () => {
  it("returns eligible players ranked best first", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const requestId = await makeRequest(
      db,
      gameId,
      homeTeamId,
      captainA,
      "setter",
    );

    const flexible = await makePlayer(db, "opposite", ["setter"], "Flex");
    const busySetter = await makePlayer(db, "setter", [], "Busy");
    const freshSetter = await makePlayer(db, "setter", [], "Fresh");
    for (const p of [flexible, busySetter, freshSetter])
      await setAvailability(db, p, TUESDAY);

    // `busySetter` subbed in an earlier game this month.
    const earlier = await makeGame(db, { weeksAhead: -1 });
    const earlierRequest = await makeRequest(
      db,
      earlier.gameId,
      earlier.homeTeamId,
      earlier.captainA,
    );
    await makeClaim(db, earlierRequest, earlier.gameId, busySetter);

    const res = await app.inject({
      method: "GET",
      url: `/sub-requests/${requestId}/candidates`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.position).toBe("setter");
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual([
      "Fresh",
      "Busy",
      "Flex",
    ]);
    expect(body.candidates[0]).toMatchObject({
      rank: 1,
      matchesPrimaryPosition: true,
      recentSubs: 0,
    });
  });

  it("returns 404 for a request that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/sub-requests/999/candidates",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 once the request is filled", async () => {
    const { gameId, homeTeamId, captainA } = await makeGame(db);
    const requestId = await makeRequest(db, gameId, homeTeamId, captainA);
    await db.query(`UPDATE sub_requests SET status = 'filled' WHERE id = $1`, [
      requestId,
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/sub-requests/${requestId}/candidates`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_open" });
  });
});
