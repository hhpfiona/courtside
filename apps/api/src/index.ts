// The entry point for the API server. 
// Creates a database connection pool, builds the Fastify app, and starts listening for requests.

import { buildApp } from "./app.js";
import { createPool } from "./db.js";

const db = createPool();
const app = buildApp(db);
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
