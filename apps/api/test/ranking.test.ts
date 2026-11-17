import { describe, expect, it } from "vitest";
import { rankCandidates, type Candidate } from "../src/ranking.js";

const candidate = (
  overrides: Partial<Candidate> & { playerId: number },
): Candidate => ({
  name: `Player ${overrides.playerId}`,
  primaryPosition: "outside",
  otherPositions: [],
  recentSubs: 0,
  ...overrides,
});

describe("rankCandidates", () => {
  it("puts players whose main position matches ahead of others", () => {
    const ranked = rankCandidates("setter", [
      candidate({
        playerId: 1,
        primaryPosition: "opposite",
        otherPositions: ["setter"],
      }),
      candidate({ playerId: 2, primaryPosition: "setter" }),
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual([2, 1]);
    expect(ranked[0]).toMatchObject({ rank: 1, matchesPrimaryPosition: true });
    expect(ranked[1]).toMatchObject({ rank: 2, matchesPrimaryPosition: false });
  });

  it("prefers players who have subbed less recently, within the same match level", () => {
    const ranked = rankCandidates("middle", [
      candidate({ playerId: 1, primaryPosition: "middle", recentSubs: 3 }),
      candidate({ playerId: 2, primaryPosition: "middle", recentSubs: 0 }),
      candidate({ playerId: 3, primaryPosition: "middle", recentSubs: 1 }),
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual([2, 3, 1]);
  });

  it("ranks position match above fewer recent subs", () => {
    const ranked = rankCandidates("libero", [
      candidate({
        playerId: 1,
        primaryPosition: "defensive_specialist",
        otherPositions: ["libero"],
      }),
      candidate({ playerId: 2, primaryPosition: "libero", recentSubs: 5 }),
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual([2, 1]);
  });

  it("breaks remaining ties by name, then id, so the order is stable", () => {
    const ranked = rankCandidates("outside", [
      candidate({ playerId: 3, name: "Bea" }),
      candidate({ playerId: 2, name: "Ada" }),
      candidate({ playerId: 1, name: "Bea" }),
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual([2, 1, 3]);
  });

  it("drops players who don't play the position at all", () => {
    const ranked = rankCandidates("setter", [
      candidate({ playerId: 1, primaryPosition: "middle" }),
      candidate({ playerId: 2, primaryPosition: "setter" }),
    ]);
    expect(ranked.map((c) => c.playerId)).toEqual([2]);
  });

  it("returns an empty list when nobody is eligible", () => {
    expect(rankCandidates("setter", [])).toEqual([]);
  });

  it("does not change the input array", () => {
    const input = [
      candidate({ playerId: 1, recentSubs: 2 }),
      candidate({ playerId: 2, recentSubs: 0 }),
    ];
    const before = structuredClone(input);
    rankCandidates("outside", input);
    expect(input).toEqual(before);
  });
});
