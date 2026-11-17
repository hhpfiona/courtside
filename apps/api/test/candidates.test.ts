import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findEligibleCandidates } from "../src/candidates.js";
import {
  addMember,
  insertGame,
  makeClaim,
  makeGame,
  makePlayer,
  makeRequest,
  resetDb,
  setAvailability,
  testPool,
} from "./helpers.js";

const db = testPool();
beforeEach(() => resetDb(db));
afterAll(() => db.end());

// The default test game is next Tuesday, 20:00–21:00 Toronto time.
const TUESDAY = 2;

/** A setter request on the default game, plus an available outside setter. */
async function setup() {
  const game = await makeGame(db);
  const requestId = await makeRequest(
    db,
    game.gameId,
    game.homeTeamId,
    game.captainA,
    "setter",
  );
  const sub = await makePlayer(db, "setter", [], "Available Setter");
  await setAvailability(db, sub, TUESDAY);
  return { ...game, requestId, sub };
}

const ids = async (requestId: number) =>
  (await findEligibleCandidates(db, requestId)).map((c) => c.playerId);

describe("findEligibleCandidates", () => {
  it("finds an available player whose main position matches", async () => {
    const { requestId, sub } = await setup();
    const [found] = await findEligibleCandidates(db, requestId);
    expect(found).toEqual({
      playerId: sub,
      name: "Available Setter",
      primaryPosition: "setter",
      otherPositions: [],
      recentSubs: 0,
    });
  });

  it("includes players who list the position under other positions", async () => {
    const { requestId, sub } = await setup();
    const flexible = await makePlayer(db, "opposite", ["setter"]);
    await setAvailability(db, flexible, TUESDAY);
    expect((await ids(requestId)).sort()).toEqual([sub, flexible].sort());
  });

  it("leaves out players who don't play the position", async () => {
    const { requestId, sub } = await setup();
    const middle = await makePlayer(db, "middle");
    await setAvailability(db, middle, TUESDAY);
    expect(await ids(requestId)).toEqual([sub]);
  });

  it("leaves out players on either team in the game", async () => {
    const { requestId, sub, homeTeamId, awayTeamId } = await setup();
    const home = await makePlayer(db, "setter");
    const away = await makePlayer(db, "setter");
    await addMember(db, homeTeamId, home);
    await addMember(db, awayTeamId, away);
    await setAvailability(db, home, TUESDAY);
    await setAvailability(db, away, TUESDAY);
    expect(await ids(requestId)).toEqual([sub]);
  });

  it("requires an availability window on the game's weekday", async () => {
    const { requestId, sub } = await setup();
    const wrongDay = await makePlayer(db, "setter");
    await setAvailability(db, wrongDay, TUESDAY + 1);
    await makePlayer(db, "setter"); // no windows at all
    expect(await ids(requestId)).toEqual([sub]);
  });

  it("requires the window to cover the whole game", async () => {
    const { requestId, sub } = await setup();
    const leavesEarly = await makePlayer(db, "setter");
    await setAvailability(db, leavesEarly, TUESDAY, "18:00", "20:30");
    const arrivesLate = await makePlayer(db, "setter");
    await setAvailability(db, arrivesLate, TUESDAY, "20:15", "23:00");
    const exactFit = await makePlayer(db, "setter");
    await setAvailability(db, exactFit, TUESDAY, "20:00", "21:00");
    expect((await ids(requestId)).sort()).toEqual([sub, exactFit].sort());
  });

  it("compares in Toronto time, not UTC", async () => {
    // 20:00 Toronto on Tuesday is 01:00 UTC on Wednesday. A Wednesday
    // 00:00–02:00 window would only match if the query used UTC.
    const { requestId, sub } = await setup();
    const utcTrap = await makePlayer(db, "setter");
    await setAvailability(db, utcTrap, TUESDAY + 1, "00:00", "02:00");
    expect(await ids(requestId)).toEqual([sub]);
  });

  it("leaves out players whose own team plays at an overlapping time", async () => {
    const { requestId, sub } = await setup();
    const other = await makeGame(db, { start: "20:30" });
    const busy = await makePlayer(db, "setter");
    await addMember(db, other.homeTeamId, busy);
    await setAvailability(db, busy, TUESDAY);
    // Their own game later the same night does not overlap, so that's fine.
    const laterGame = await makeGame(db, { start: "21:00" });
    const free = await makePlayer(db, "setter");
    await addMember(db, laterGame.homeTeamId, free);
    await setAvailability(db, free, TUESDAY);
    expect((await ids(requestId)).sort()).toEqual([sub, free].sort());
  });

  it("leaves out players who already claimed a spot at an overlapping time", async () => {
    const { requestId, sub, gameId, awayTeamId, captainB } = await setup();
    // A second request in the same game, already taken by `sub`.
    const awayRequest = await makeRequest(
      db,
      gameId,
      awayTeamId,
      captainB,
      "setter",
    );
    await makeClaim(db, awayRequest, gameId, sub);
    expect(await ids(requestId)).toEqual([]);
  });

  it("counts claims from the last 30 days only", async () => {
    const { requestId, sub, leagueId, homeTeamId, awayTeamId, captainA } =
      await setup();
    const oldGame = await insertGame(db, leagueId, homeTeamId, awayTeamId, {
      weeksAhead: -8,
    });
    const recentGame = await insertGame(db, leagueId, homeTeamId, awayTeamId, {
      weeksAhead: -1,
    });
    const oldRequest = await makeRequest(db, oldGame, homeTeamId, captainA);
    const recentRequest = await makeRequest(
      db,
      recentGame,
      homeTeamId,
      captainA,
    );
    await makeClaim(
      db,
      oldRequest,
      oldGame,
      sub,
      new Date(Date.now() - 60 * 864e5),
    );
    await makeClaim(
      db,
      recentRequest,
      recentGame,
      sub,
      new Date(Date.now() - 7 * 864e5),
    );
    const [found] = await findEligibleCandidates(db, requestId);
    expect(found?.recentSubs).toBe(1);
  });

  it("returns nothing for a request that does not exist", async () => {
    expect(await findEligibleCandidates(db, 999)).toEqual([]);
  });
});
