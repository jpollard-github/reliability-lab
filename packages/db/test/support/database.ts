import { afterAll, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase } from "../../src/index.js";

export function useIntegrationDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const connection = databaseUrl ? createDatabase(databaseUrl) : null;

  beforeAll(async () => {
    if (!connection) {
      throw new Error(
        "DATABASE_URL is required. Run `pnpm dev:infra` and `pnpm db:migrate` before integration tests.",
      );
    }
    await connection.db.execute(sql`select 1`);
  });

  afterAll(async () => {
    if (connection) await connection.pool.end();
  });

  return connection;
}
