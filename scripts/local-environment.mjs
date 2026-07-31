import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Loads only repository-local development files. Existing process variables retain precedence;
 * loading .env.local first gives it precedence over .env because Node never overwrites a value.
 */
export function loadRepositoryLocalEnvironment({
  rootDirectory = repositoryRoot,
  environment = process.env,
} = {}) {
  if (environment.NODE_ENV === "production") return [];

  const loaded = [];
  for (const filename of [".env.local", ".env"]) {
    const path = join(rootDirectory, filename);
    if (!existsSync(path)) continue;
    loadEnvFile(path);
    loaded.push(filename);
  }
  return loaded;
}
