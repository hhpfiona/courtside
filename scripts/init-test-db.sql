-- Runs once when the Postgres container is first created.
-- Tests use their own database so they never touch dev data.
CREATE DATABASE courtside_test OWNER courtside;
