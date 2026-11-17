# Courtside

Courtside finds subs for rec volleyball leagues. A captain posts a request such as "need a setter, Thursday 8 pm". Courtside ranks players who play that position and are free then, and the first eligible player to claim the spot gets it. Two players can never both get the same spot.

> **Status:** in progress. The schema, the players and sub-request API, and the ranking are done. Claiming a spot, the UI, CI and deploy come next.

## Stack

TypeScript · Node · Fastify · PostgreSQL 16 · node-pg-migrate · Vitest · Docker Compose

## Run it locally

You need Node 22.12+ and Docker Desktop.

```bash
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm install
npm run db:up                 # starts Postgres in Docker (dev + test databases)
npm run migrate -- up         # creates the tables
npm run seed                  # adds a made-up league with 24 players
npm run dev                   # API on http://localhost:3000
```

Check it's working: `http://localhost:3000/health` should return `{"status":"ok","db":"up"}`.

## Run the tests

```bash
npm test
```

The tests run against a separate `courtside_test` database. Before each run they roll every migration down and back up, so the down migrations get tested as well.

## API

All errors come back as `{ "error": "<code>", "message": "<text>" }`. Request bodies with unknown fields are rejected with a 400 rather than silently ignored.

| Method | Path                           | What it does                                                                                          |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                      | `200` if the API can reach the database, `503` if not                                                 |
| `POST` | `/players`                     | Create a player (`name`, `email`, `primaryPosition`, optional `otherPositions`)                       |
| `GET`  | `/players/:id`                 | A player and their weekly availability                                                                |
| `PUT`  | `/players/:id/availability`    | Replace all of a player's weekly windows (`dayOfWeek` 0 = Sunday, `startTime` / `endTime` as `HH:MM`) |
| `POST` | `/games/:gameId/sub-requests`  | A captain asks for a sub (`teamId`, `position`, `requestedBy`, optional `note`)                       |
| `GET`  | `/sub-requests?status=open`    | Upcoming requests, soonest first                                                                      |
| `GET`  | `/sub-requests/:id/candidates` | Eligible subs for an open request, ranked                                                             |

There is no login yet, so `requestedBy` is taken on trust; it will come from the signed-in user once authentication is added.

## How subs are ranked

A player is **eligible** for a request when they play the position (as their main one or another one), aren't on either team, aren't playing or subbing in another game at the same time, and have an availability window that covers the whole game in Toronto time. That filtering happens in one SQL query (`apps/api/src/candidates.ts`).

Eligible players are then **ranked** by a pure function (`apps/api/src/ranking.ts`), so the rules are easy to test and change:

1. Main position matches first.
2. Then whoever has subbed the least in the last 30 days, so spots get spread around.
3. Then by name, so the order is always the same.

## How double-booking is prevented

The database enforces it, so it holds even if the application code has a bug:

- `claims.sub_request_id` is `UNIQUE`: a spot can only be claimed once.
- `UNIQUE (player_id, game_id)` on `claims`: one player can't take two spots in the same game.
- A composite foreign key `(sub_request_id, game_id)`: a claim's game always matches its request's game.

The claim endpoint (Day 3) also locks the request row inside a transaction. That way, when two players claim at the same moment, one gets a success and the other gets a clear "already taken" message, never a raw database error.
