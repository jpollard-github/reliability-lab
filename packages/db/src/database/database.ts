/**
 * Owns PostgreSQL pool and Drizzle construction plus the shared database type.
 * Repositories receive this type and never create their own connection.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../schema/index.js";

export type ReliabilityDatabase = NodePgDatabase<typeof schema>;

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
