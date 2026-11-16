import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { testPool } from "./helpers.js";

describe("GET /health", () => {
  const db = testPool();
  const app = buildApp(db);
  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("reports ok when the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "up" });
  });

  it("reports 503 when the database is unreachable", async () => {
    const deadDb = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
    const deadApp = buildApp(deadDb);
    const res = await deadApp.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    await deadApp.close();
    await deadDb.end();
  });
});
