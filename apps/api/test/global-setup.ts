import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}

/**
 * Rebuilds the test database from scratch before the suite: every migration
 * down, then every migration up. This also proves the down migrations work.
 */
export default async function setup() {
  const base = {
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    migrationsTable: "pgmigrations",
    useGlob: false,
    log: () => {},
  } as const;
  await runner({ ...base, direction: "down", count: Infinity });
  await runner({ ...base, direction: "up", count: Infinity });
}
