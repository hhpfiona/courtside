-- Up Migration

CREATE TYPE court_position AS ENUM (
  'setter', 'outside', 'opposite', 'middle', 'libero', 'defensive_specialist'
);

CREATE TYPE sub_request_status AS ENUM ('open', 'filled', 'cancelled');

CREATE TABLE players (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                text NOT NULL CHECK (length(trim(name)) > 0),
  email               text NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  primary_position    court_position NOT NULL,
  -- Positions a player is also willing to sub in (may be empty).
  other_positions     court_position[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (primary_position = ANY (other_positions)))
);

CREATE TABLE leagues (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  venue       text NOT NULL,
  level       text NOT NULL,  -- e.g. 'Recreational', 'Intermediate', 'Competitive'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id   bigint NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
  name        text NOT NULL,
  captain_id  bigint NOT NULL REFERENCES players (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, name)
);

CREATE TABLE team_members (
  team_id    bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  player_id  bigint NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, player_id)
);
CREATE INDEX team_members_player_idx ON team_members (player_id);

CREATE TABLE games (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id     bigint NOT NULL REFERENCES leagues (id) ON DELETE CASCADE,
  home_team_id  bigint NOT NULL REFERENCES teams (id),
  away_team_id  bigint NOT NULL REFERENCES teams (id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  court         text,
  CHECK (home_team_id <> away_team_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX games_starts_at_idx ON games (starts_at);

-- Recurring weekly windows when a player can sub.
-- Times are local to the league's city (America/Toronto for now).
CREATE TABLE availability (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id    bigint NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX availability_player_idx ON availability (player_id);

CREATE TABLE sub_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id       bigint NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  team_id       bigint NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  position      court_position NOT NULL,
  requested_by  bigint NOT NULL REFERENCES players (id),
  status        sub_request_status NOT NULL DEFAULT 'open',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Lets claims reference (id, game_id) so a claim's game always matches its request.
  UNIQUE (id, game_id)
);
-- The API checks that team_id is one of the game's two teams.
CREATE INDEX sub_requests_open_idx ON sub_requests (game_id) WHERE status = 'open';

-- A claim fills exactly one request. The two unique constraints are the
-- database-level backstop against double-booking:
--   * one claim per request (two subs can't take the same spot)
--   * one claim per player per game (one sub can't take two spots in a game)
CREATE TABLE claims (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sub_request_id  bigint NOT NULL UNIQUE,
  game_id         bigint NOT NULL,
  player_id       bigint NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sub_request_id, game_id)
    REFERENCES sub_requests (id, game_id) ON DELETE CASCADE,
  UNIQUE (player_id, game_id)
);

-- Down Migration

DROP TABLE claims;
DROP TABLE sub_requests;
DROP TABLE availability;
DROP TABLE games;
DROP TABLE team_members;
DROP TABLE teams;
DROP TABLE leagues;
DROP TABLE players;
DROP TYPE sub_request_status;
DROP TYPE court_position;
