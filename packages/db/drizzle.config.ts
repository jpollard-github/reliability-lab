import { defineConfig } from "drizzle-kit";

const localDatabaseUrl =
  process.env.DATABASE_URL ?? "postgresql://reliability:reliability@localhost:5432/reliability_lab";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: localDatabaseUrl },
  strict: true,
  verbose: true,
});
