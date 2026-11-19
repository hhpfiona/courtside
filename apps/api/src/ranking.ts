// Makes a decision about which eligible players should be offered a sub request first, based on position, recent subs, and name.

import type { Position } from "./domain.js";

/** A player who passed the eligibility checks in the database. */
export interface Candidate {
  playerId: number;
  name: string;
  primaryPosition: Position;
  otherPositions: Position[];
  /** How many spots this player has claimed in the last 30 days. */
  recentSubs: number;
}

export interface RankedCandidate extends Candidate {
  rank: number;
  matchesPrimaryPosition: boolean;
}

/**
 * Orders eligible subs for a request. Pure, so it is easy to test.
 *
 * 1. Players whose main position is the one needed come first.
 * 2. Then players who have subbed less recently, so the same few people
 *    don't get every spot.
 * 3. Then by name, then id, so the order is always the same.
 *
 * Players who don't play the position at all are dropped.
 */
export function rankCandidates(
  position: Position,
  candidates: readonly Candidate[],
): RankedCandidate[] {
  return candidates
    .filter(
      (c) =>
        c.primaryPosition === position || c.otherPositions.includes(position),
    )
    .map((c) => ({
      ...c,
      matchesPrimaryPosition: c.primaryPosition === position,
    }))
    .sort(
      (a, b) =>
        Number(b.matchesPrimaryPosition) - Number(a.matchesPrimaryPosition) ||
        a.recentSubs - b.recentSubs ||
        a.name.localeCompare(b.name) ||
        a.playerId - b.playerId,
    )
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
