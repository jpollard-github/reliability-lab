import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProviderRuntime } from "../packages/providers/src/provider-runtime.ts";
import { loadRepositoryLocalEnvironment } from "./local-environment.mjs";

const testKeys = [
  "LOCAL_ENV_BASE_TEST",
  "LOCAL_ENV_OVERRIDE_TEST",
  "LOCAL_ENV_EXAMPLE_TEST",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];
const originalValues = new Map(testKeys.map((key) => [key, process.env[key]]));
const fixtureDirectories = [];

beforeEach(() => {
  for (const key of testKeys) delete process.env[key];
});

afterEach(async () => {
  for (const key of testKeys) {
    const original = originalValues.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("loadRepositoryLocalEnvironment", () => {
  it("tolerates missing files and never loads .env.example", async () => {
    const directory = await fixture();
    await writeFile(join(directory, ".env.example"), "LOCAL_ENV_EXAMPLE_TEST=do-not-load\n");

    expect(loadRepositoryLocalEnvironment({ rootDirectory: directory })).toEqual([]);
    expect(process.env.LOCAL_ENV_EXAMPLE_TEST).toBeUndefined();
    expect(
      buildProviderRuntime({}).capabilities.find((item) => item.kind === "live"),
    ).toMatchObject({
      configured: false,
      operatorEligible: false,
    });
  });

  it("loads .env.local over .env while exported variables retain precedence", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, ".env"),
      "LOCAL_ENV_BASE_TEST=from-env\nLOCAL_ENV_OVERRIDE_TEST=from-env\n",
    );
    await writeFile(join(directory, ".env.local"), "LOCAL_ENV_OVERRIDE_TEST=from-local\n");
    process.env.LOCAL_ENV_BASE_TEST = "exported-value";

    expect(loadRepositoryLocalEnvironment({ rootDirectory: directory })).toEqual([
      ".env.local",
      ".env",
    ]);
    expect(process.env.LOCAL_ENV_BASE_TEST).toBe("exported-value");
    expect(process.env.LOCAL_ENV_OVERRIDE_TEST).toBe("from-local");
  });

  it("gives API and worker construction the same complete local provider configuration", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, ".env"),
      [
        "OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:43123/v1",
        "OPENAI_API_KEY=local-fixture-key",
        "OPENAI_MODEL=local-fixture-model",
        "",
      ].join("\n"),
    );

    loadRepositoryLocalEnvironment({ rootDirectory: directory });
    const apiRuntime = buildProviderRuntime(process.env);
    const workerRuntime = buildProviderRuntime(process.env);
    const apiLive = apiRuntime.capabilities.find((item) => item.kind === "live");
    const workerLive = workerRuntime.capabilities.find((item) => item.kind === "live");

    expect(apiLive).toEqual(workerLive);
    expect(apiLive).toMatchObject({
      configured: true,
      operatorEligible: true,
      modelLabel: "local-fixture-model",
    });
    expect(JSON.stringify(apiLive)).not.toContain("local-fixture-key");
    expect(JSON.stringify(apiLive)).not.toContain("127.0.0.1");
  });

  it("does not load local files for an explicit production environment", async () => {
    const directory = await fixture();
    await writeFile(join(directory, ".env"), "LOCAL_ENV_BASE_TEST=from-env\n");

    expect(
      loadRepositoryLocalEnvironment({
        rootDirectory: directory,
        environment: { NODE_ENV: "production" },
      }),
    ).toEqual([]);
    expect(process.env.LOCAL_ENV_BASE_TEST).toBeUndefined();
  });

  it("wires every root development process and the live verifier through one loader", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    for (const name of [
      "dev",
      "dev:durable",
      "dev:api",
      "dev:worker",
      "dev:web",
      "verify:live-provider",
    ]) {
      expect(packageJson.scripts[name]).toContain(
        "NODE_OPTIONS=--import=./scripts/register-local-environment.mjs",
      );
    }
  });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "reliability-local-env-test-"));
  fixtureDirectories.push(directory);
  return directory;
}
