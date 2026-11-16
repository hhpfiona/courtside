import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db.js";

export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", db: "up" };
    } catch {
      return reply.code(503).send({ status: "degraded", db: "down" });
    }
  });

  return app;
}
