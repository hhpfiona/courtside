/**
 * Fills the dev database with a small, made-up rec league so the API and UI
 * have something to show. Every name here is fictional.
 *
 *   npm run seed            # wipes app tables, then inserts sample data
 */
import { createPool } from "../src/db.js";

type Position =
  | "setter"
  | "outside"
  | "opposite"
  | "middle"
  | "libero"
  | "defensive_specialist";

const PLAYERS: Array<[string, Position, Position[]]> = [
  ["Maya Okafor", "setter", ["opposite"]],
  ["Ravi Sandhu", "outside", ["opposite"]],
  ["Lena Moreau", "middle", []],
  ["Theo Nguyen", "libero", ["defensive_specialist"]],
  ["Priya Desai", "opposite", ["outside"]],
  ["Sam Kowalski", "outside", []],
  ["Jordan Reyes", "setter", []],
  ["Aiko Tanaka", "middle", ["opposite"]],
  ["Chris Boateng", "outside", ["middle"]],
  ["Nadia Haddad", "libero", []],
  ["Owen Fraser", "opposite", []],
  ["Bea Lindqvist", "setter", ["defensive_specialist"]],
  ["Marco Ricci", "middle", []],
  ["Hana Park", "outside", ["libero"]],
  ["Dev Malhotra", "defensive_specialist", ["libero"]],
  ["Elise Tremblay", "setter", ["outside"]],
  ["Kwame Mensah", "middle", ["outside"]],
  ["Sofia Alvarez", "outside", []],
  ["Liam O'Connor", "opposite", ["middle"]],
  ["Grace Liu", "libero", []],
  ["Felix Wagner", "outside", ["opposite"]],
  ["Isla Campbell", "middle", []],
  ["Tariq Hassan", "setter", []],
  ["Mei Chen", "defensive_specialist", ["outside"]],
];

/** The next date (local time) that falls on `weekday` (0 = Sunday), at hh:mm. */
function nextWeekday(
  weekday: number,
  hh: number,
  mm: number,
  weeksAhead = 0,
): Date {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff + weeksAhead * 7);
  return d;
}

async function main() {
  const db = createPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE claims, sub_requests, availability, games, team_members, teams, leagues, players
       RESTART IDENTITY CASCADE`,
    );

    const playerIds: number[] = [];
    for (const [name, primary, others] of PLAYERS) {
      const email =
        name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com";
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO players (name, email, primary_position, other_positions)
         VALUES ($1, $2, $3, $4::court_position[]) RETURNING id`,
        [name, email, primary, others],
      );
      playerIds.push(rows[0]!.id);
    }

    const leagues = [
      ["Monday Night Coed 6s", "Eastside Community Centre", "Intermediate", 1],
      ["Thursday Rec 6s", "Lakeshore Rec Gym", "Recreational", 4],
    ] as const;

    let p = 0; // next player index to place on a team
    for (const [name, venue, level, weekday] of leagues) {
      const { rows: lr } = await client.query<{ id: number }>(
        `INSERT INTO leagues (name, venue, level) VALUES ($1, $2, $3) RETURNING id`,
        [name, venue, level],
      );
      const leagueId = lr[0]!.id;

      // Two teams of 6 per league.
      const teamIds: number[] = [];
      for (const teamName of weekday === 1
        ? ["Net Profits", "Block Party"]
        : ["Dig Deep", "Set Ready"]) {
        const roster = playerIds.slice(p, p + 6);
        p += 6;
        const { rows: tr } = await client.query<{ id: number }>(
          `INSERT INTO teams (league_id, name, captain_id) VALUES ($1, $2, $3) RETURNING id`,
          [leagueId, teamName, roster[0]],
        );
        const teamId = tr[0]!.id;
        teamIds.push(teamId);
        for (const pid of roster) {
          await client.query(
            `INSERT INTO team_members (team_id, player_id) VALUES ($1, $2)`,
            [teamId, pid],
          );
        }
      }

      // Three upcoming weekly games at 8 pm.
      for (let w = 0; w < 3; w++) {
        const start = nextWeekday(weekday, 20, 0, w);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const { rows: gr } = await client.query<{ id: number }>(
          `INSERT INTO games (league_id, home_team_id, away_team_id, starts_at, ends_at, court)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            leagueId,
            teamIds[w % 2],
            teamIds[(w + 1) % 2],
            start,
            end,
            `Court ${w + 1}`,
          ],
        );
        // An open request for the first game of each league.
        if (w === 0) {
          await client.query(
            `INSERT INTO sub_requests (game_id, team_id, position, requested_by, note)
             SELECT $1, t.id, $2, t.captain_id, $3 FROM teams t WHERE t.id = $4`,
            [
              gr[0]!.id,
              weekday === 1 ? "setter" : "middle",
              "Regular is away this week",
              teamIds[0],
            ],
          );
        }
      }
    }

    // Availability: everyone is free some evenings; vary it by index.
    for (const [i, pid] of playerIds.entries()) {
      const days = [1, 2, 3, 4, 5].filter((d) => (i + d) % 3 !== 0);
      for (const day of days) {
        await client.query(
          `INSERT INTO availability (player_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, '18:00', '23:00')`,
          [pid, day],
        );
      }
    }

    await client.query("COMMIT");
    console.log(
      `Seeded ${playerIds.length} players, ${leagues.length} leagues, 4 teams, 6 games.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
