import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { registerErrorHandler } from "./errors.js";
import { playerRoutes } from "./routes/players.js";
import { subRequestRoutes } from "./routes/subRequests.js";

export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    // Fastify's default quietly drops unknown fields. Rejecting them instead
    // means a client typo like "primaryPostion" fails loudly with a 400.
    ajv: { customOptions: { removeAdditional: false } },
  });
  registerErrorHandler(app);

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", db: "up" };
    } catch {
      return reply.code(503).send({ status: "degraded", db: "down" });
    }
  });

  playerRoutes(app, db);
  subRequestRoutes(app, db);

  return app;
}
