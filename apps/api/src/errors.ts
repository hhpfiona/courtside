import type { FastifyError, FastifyInstance } from "fastify";

/** An error the API means to send to the client, with a stable code. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new HttpError(404, "not_found", `${what} not found`);

/** Postgres error codes the API turns into client errors. */
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";

/**
 * One place that decides what an error looks like on the wire:
 * `{ "error": "<code>", "message": "<text>" }`.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError & { code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ error: err.code, message: err.message });
    }
    if (err.validation) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: err.message });
    }
    switch (err.code) {
      case PG_UNIQUE_VIOLATION:
        return reply
          .code(409)
          .send({ error: "conflict", message: "That already exists." });
      case PG_FOREIGN_KEY_VIOLATION:
        return reply.code(422).send({
          error: "unknown_reference",
          message: "The request refers to something that does not exist.",
        });
      case PG_CHECK_VIOLATION:
        return reply.code(400).send({
          error: "invalid_request",
          message:
            "The request breaks a data rule (check times and positions).",
        });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: "internal", message: "Something went wrong." });
  });
}
