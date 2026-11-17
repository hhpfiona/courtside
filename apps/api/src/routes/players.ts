import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { POSITIONS, type Position } from "../domain.js";
import { HttpError, notFound } from "../errors.js";

const TIME = {
  type: "string",
  pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
} as const;
const ID_PARAMS = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

interface NewPlayer {
  name: string;
  email: string;
  primaryPosition: Position;
  otherPositions?: Position[];
}

interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const PLAYER_COLUMNS = `
  id, name, email,
  primary_position AS "primaryPosition",
  other_positions::text[] AS "otherPositions",
  created_at AS "createdAt"`;

async function getAvailability(db: Db, playerId: number) {
  const { rows } = await db.query<AvailabilityWindow>(
    `SELECT day_of_week AS "dayOfWeek",
            to_char(start_time, 'HH24:MI') AS "startTime",
            to_char(end_time, 'HH24:MI') AS "endTime"
     FROM availability WHERE player_id = $1
     ORDER BY day_of_week, start_time`,
    [playerId],
  );
  return rows;
}

export function playerRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Body: NewPlayer }>(
    "/players",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "email", "primaryPosition"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            email: { type: "string", format: "email", maxLength: 254 },
            primaryPosition: { type: "string", enum: POSITIONS },
            otherPositions: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", enum: POSITIONS },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { name, email, primaryPosition, otherPositions = [] } = req.body;
      if (otherPositions.includes(primaryPosition)) {
        throw new HttpError(
          400,
          "invalid_request",
          "otherPositions should not repeat primaryPosition.",
        );
      }
      const { rows } = await db.query(
        `INSERT INTO players (name, email, primary_position, other_positions)
         VALUES ($1, lower($2), $3, $4::court_position[])
         RETURNING ${PLAYER_COLUMNS}`,
        [name.trim(), email, primaryPosition, otherPositions],
      );
      return reply.code(201).send(rows[0]);
    },
  );

  app.get<{ Params: { id: number } }>(
    "/players/:id",
    { schema: { params: ID_PARAMS } },
    async (req) => {
      const { rows } = await db.query(
        `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = $1`,
        [req.params.id],
      );
      if (!rows[0]) throw notFound("Player");
      return {
        ...rows[0],
        availability: await getAvailability(db, req.params.id),
      };
    },
  );

  /** Replaces all of a player's weekly availability in one go. */
  app.put<{ Params: { id: number }; Body: { windows: AvailabilityWindow[] } }>(
    "/players/:id/availability",
    {
      schema: {
        params: ID_PARAMS,
        body: {
          type: "object",
          required: ["windows"],
          additionalProperties: false,
          properties: {
            windows: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                required: ["dayOfWeek", "startTime", "endTime"],
                additionalProperties: false,
                properties: {
                  dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
                  startTime: TIME,
                  endTime: TIME,
                },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const playerId = req.params.id;
      for (const w of req.body.windows) {
        if (w.endTime <= w.startTime) {
          throw new HttpError(
            400,
            "invalid_request",
            `A window on day ${w.dayOfWeek} ends (${w.endTime}) before it starts (${w.startTime}).`,
          );
        }
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // Lock the player row so two saves at once can't interleave.
        const { rowCount } = await client.query(
          `SELECT 1 FROM players WHERE id = $1 FOR UPDATE`,
          [playerId],
        );
        if (!rowCount) throw notFound("Player");
        await client.query(`DELETE FROM availability WHERE player_id = $1`, [
          playerId,
        ]);
        for (const w of req.body.windows) {
          await client.query(
            `INSERT INTO availability (player_id, day_of_week, start_time, end_time)
             VALUES ($1, $2, $3, $4)`,
            [playerId, w.dayOfWeek, w.startTime, w.endTime],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return { playerId, availability: await getAvailability(db, playerId) };
    },
  );
}
