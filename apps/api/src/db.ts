import pg from "pg";

// Return Postgres bigint ids as JS numbers. Ids here will never pass 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  return new pg.Pool({ connectionString, max: 10 });
}
