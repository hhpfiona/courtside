// API tests 

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makePlayer, resetDb, testPool } from "./helpers.js";

const db = testPool();
const app = buildApp(db);
beforeEach(() => resetDb(db));
afterAll(async () => {
  await app.close();
  await db.end();
});

const newPlayer = {
  name: "Maya Okafor",
  email: "Maya@Example.com",
  primaryPosition: "setter",
  otherPositions: ["opposite"],
};

describe("POST /players", () => {
  it("creates a player and returns it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/players",
      payload: newPlayer,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: expect.any(Number),
      name: "Maya Okafor",
      email: "maya@example.com", // stored lowercase
      primaryPosition: "setter",
      otherPositions: ["opposite"],
    });
  });

  it("rejects a duplicate email with 409, ignoring case", async () => {
    await app.inject({ method: "POST", url: "/players", payload: newPlayer });
    const res = await app.inject({
      method: "POST",
      url: "/players",
      payload: { ...newPlayer, email: "MAYA@example.com" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "conflict" });
  });

  it.each([
    ["an unknown position", { ...newPlayer, primaryPosition: "goalie" }],
    ["a bad email", { ...newPlayer, email: "not-an-email" }],
    ["a missing name", { email: "a@example.com", primaryPosition: "setter" }],
    ["an unexpected field", { ...newPlayer, isAdmin: true }],
    [
      "the main position repeated",
      { ...newPlayer, otherPositions: ["setter"] },
    ],
  ])("rejects %s with 400", async (_label, payload) => {
    const res = await app.inject({ method: "POST", url: "/players", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("GET /players/:id", () => {
  it("returns the player with their availability", async () => {
    const id = await makePlayer(db, "libero");
    const res = await app.inject({ method: "GET", url: `/players/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      primaryPosition: "libero",
      availability: [],
    });
  });

  it("returns 404 for a missing player", async () => {
    const res = await app.inject({ method: "GET", url: "/players/999" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await app.inject({ method: "GET", url: "/players/abc" });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /players/:id/availability", () => {
  const put = (id: number, windows: unknown) =>
    app.inject({
      method: "PUT",
      url: `/players/${id}/availability`,
      payload: { windows },
    });

  it("replaces all windows and returns them sorted", async () => {
    const id = await makePlayer(db);
    await put(id, [{ dayOfWeek: 5, startTime: "18:00", endTime: "22:00" }]);
    const res = await put(id, [
      { dayOfWeek: 4, startTime: "19:00", endTime: "23:00" },
      { dayOfWeek: 2, startTime: "18:30", endTime: "22:00" },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().availability).toEqual([
      { dayOfWeek: 2, startTime: "18:30", endTime: "22:00" },
      { dayOfWeek: 4, startTime: "19:00", endTime: "23:00" },
    ]);
  });

  it("clears availability when given an empty list", async () => {
    const id = await makePlayer(db);
    await put(id, [{ dayOfWeek: 1, startTime: "18:00", endTime: "22:00" }]);
    const res = await put(id, []);
    expect(res.json().availability).toEqual([]);
  });

  it("rejects a window that ends before it starts and keeps the old windows", async () => {
    const id = await makePlayer(db);
    await put(id, [{ dayOfWeek: 1, startTime: "18:00", endTime: "22:00" }]);
    const res = await put(id, [
      { dayOfWeek: 3, startTime: "22:00", endTime: "19:00" },
    ]);
    expect(res.statusCode).toBe(400);
    const after = await app.inject({ method: "GET", url: `/players/${id}` });
    expect(after.json().availability).toHaveLength(1);
  });

  it.each([
    [
      "a day out of range",
      { dayOfWeek: 7, startTime: "18:00", endTime: "22:00" },
    ],
    [
      "a badly formatted time",
      { dayOfWeek: 1, startTime: "6pm", endTime: "22:00" },
    ],
    [
      "an impossible time",
      { dayOfWeek: 1, startTime: "18:00", endTime: "24:30" },
    ],
  ])("rejects %s with 400", async (_label, window) => {
    const id = await makePlayer(db);
    const res = await put(id, [window]);
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a missing player", async () => {
    const res = await put(999, []);
    expect(res.statusCode).toBe(404);
  });
});
