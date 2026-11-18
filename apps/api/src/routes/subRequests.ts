// Fetches players who are eligible to fill a sub request using SQL,
// based on position, team membership, game conflicts, and availability.

import type { FastifyInstance } from "fastify";
import { findEligibleCandidates } from "../candidates.js";
import type { Db } from "../db.js";
import { POSITIONS, type Position } from "../domain.js";
import { HttpError, notFound } from "../errors.js";
import { rankCandidates } from "../ranking.js";

const idParams = (name: string) =>
  ({
    type: "object",
    required: [name],
    properties: { [name]: { type: "integer", minimum: 1 } },
  }) as const;

const REQUEST_COLUMNS = `
  sr.id, sr.game_id AS "gameId", sr.team_id AS "teamId", t.name AS "teamName",
  sr.position, sr.status, sr.note, sr.requested_by AS "requestedBy",
  g.starts_at AS "startsAt", g.ends_at AS "endsAt", g.court,
  l.name AS "leagueName", l.venue`;

const REQUEST_FROM = `
  sub_requests sr
  JOIN games g ON g.id = sr.game_id
  JOIN teams t ON t.id = sr.team_id
  JOIN leagues l ON l.id = g.league_id`;

interface NewSubRequest {
  teamId: number;
  position: Position;
  requestedBy: number;
  note?: string;
}

export function subRequestRoutes(app: FastifyInstance, db: Db): void {
  /**
   * A captain asks for a sub for one of their team's games.
   * There is no login yet, so `requestedBy` is trusted; checking it against
   * the signed-in user comes with authentication.
   */
  app.post<{ Params: { gameId: number }; Body: NewSubRequest }>(
    "/games/:gameId/sub-requests",
    {
      schema: {
        params: idParams("gameId"),
        body: {
          type: "object",
          required: ["teamId", "position", "requestedBy"],
          additionalProperties: false,
          properties: {
            teamId: { type: "integer", minimum: 1 },
            position: { type: "string", enum: POSITIONS },
            requestedBy: { type: "integer", minimum: 1 },
            note: { type: "string", maxLength: 280 },
          },
        },
      },
    },
    async (req, reply) => {
      const { gameId } = req.params;
      const { teamId, position, requestedBy, note } = req.body;

      const { rows: games } = await db.query<{
        homeTeamId: number;
        awayTeamId: number;
        hasStarted: boolean;
      }>(
        `SELECT home_team_id AS "homeTeamId", away_team_id AS "awayTeamId",
                starts_at <= now() AS "hasStarted"
         FROM games WHERE id = $1`,
        [gameId],
      );
      const game = games[0];
      if (!game) throw notFound("Game");
      if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) {
        throw new HttpError(
          422,
          "team_not_in_game",
          "That team is not playing in this game.",
        );
      }
      if (game.hasStarted) {
        throw new HttpError(
          422,
          "game_started",
          "This game has already started.",
        );
      }

      const { rows: teams } = await db.query<{ captainId: number }>(
        `SELECT captain_id AS "captainId" FROM teams WHERE id = $1`,
        [teamId],
      );
      if (teams[0]?.captainId !== requestedBy) {
        throw new HttpError(
          403,
          "not_captain",
          "Only the team's captain can ask for a sub.",
        );
      }

      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO sub_requests (game_id, team_id, position, requested_by, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [gameId, teamId, position, requestedBy, note ?? null],
      );
      const created = await db.query(
        `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM} WHERE sr.id = $1`,
        [rows[0]!.id],
      );
      return reply.code(201).send(created.rows[0]);
    },
  );

  /** Upcoming requests, soonest first. Defaults to the open ones. */
  app.get<{ Querystring: { status: "open" | "filled" | "cancelled" } }>(
    "/sub-requests",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: ["open", "filled", "cancelled"],
              default: "open",
            },
          },
        },
      },
    },
    async (req) => {
      const { rows } = await db.query(
        `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM}
         WHERE sr.status = $1 AND g.starts_at > now()
         ORDER BY g.starts_at, sr.id`,
        [req.query.status],
      );
      return rows;
    },
  );

  /** Eligible subs for one open request, best match first. */
  app.get<{ Params: { id: number } }>(
    "/sub-requests/:id/candidates",
    { schema: { params: idParams("id") } },
    async (req) => {
      const { rows } = await db.query<{ position: Position; status: string }>(
        `SELECT position, status FROM sub_requests WHERE id = $1`,
        [req.params.id],
      );
      const request = rows[0];
      if (!request) throw notFound("Sub request");
      if (request.status !== "open") {
        throw new HttpError(
          409,
          "not_open",
          `This request is already ${request.status}.`,
        );
      }
      const candidates = await findEligibleCandidates(db, req.params.id);
      return {
        subRequestId: req.params.id,
        position: request.position,
        candidates: rankCandidates(request.position, candidates),
      };
    },
  );
}
