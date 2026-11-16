# Courtside

Courtside finds subs for rec volleyball leagues. A captain posts a request such as "need a setter, Thursday 8 pm". Courtside ranks players who play that position and are free then, and the first eligible player to claim the spot gets it. Two players can never both get the same spot.

> **Status:** in progress. Day 1 is done (schema, migrations, sample data, health check). The API, UI, CI and deploy come next.

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

## How double-booking is prevented

The database enforces it, so it holds even if the application code has a bug:

- `claims.sub_request_id` is `UNIQUE`: a spot can only be claimed once.
- `UNIQUE (player_id, game_id)` on `claims`: one player can't take two spots in the same game.
- A composite foreign key `(sub_request_id, game_id)`: a claim's game always matches its request's game.

The claim endpoint (Day 3) also locks the request row inside a transaction. That way, when two players claim at the same moment, one gets a success and the other gets a clear "already taken" message, never a raw database error.
