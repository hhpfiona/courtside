/** Shared constants and types for the volleyball domain. */

export const POSITIONS = [
  "setter",
  "outside",
  "opposite",
  "middle",
  "libero",
  "defensive_specialist",
] as const;

export type Position = (typeof POSITIONS)[number];

/**
 * Every league is in Toronto for now, so game times are compared with
 * availability windows in this time zone. Becomes a per-league column later.
 */
export const LEAGUE_TIME_ZONE = "America/Toronto";
