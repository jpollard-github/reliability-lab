/**
 * Proves that public workspace exports and both process entrypoints resolve emitted JavaScript.
 * Full API/worker health checks remain in the runtime verification workflow because the worker
 * requires migrated PostgreSQL state and configured keyrings.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const baseEnvironment = { ...process.env };
delete baseEnvironment.NODE_OPTIONS;

await importPackages(resolve(root, "apps/api"), [
  "@reliability-lab/contracts",
  "@reliability-lab/core",
  "@reliability-lab/db",
  "@reliability-lab/observability",
  "@reliability-lab/providers",
]);
await importPackages(resolve(root, "packages/core"), ["@reliability-lab/testkit"]);
await runEntrypoint(resolve(root, "apps/api"), "api built-runtime imports resolved");
await runEntrypoint(resolve(root, "apps/worker"), "worker built-runtime imports resolved");
process.stdout.write("Built runtime smoke passed for workspace exports, API, and worker\n");

async function importPackages(cwd, packages) {
  const source = `await Promise.all(${JSON.stringify(packages)}.map((name) => import(name)))`;
  await run(process.execPath, ["--input-type=module", "--eval", source], cwd, baseEnvironment);
}

async function runEntrypoint(cwd, expectedMarker) {
  const result = await run(process.execPath, ["dist/server.js"], cwd, {
    ...baseEnvironment,
    RELIABILITY_LAB_RUNTIME_IMPORT_SMOKE: "true",
  });
  if (!result.stdout.includes(expectedMarker)) {
    throw new Error(`Built entrypoint did not report its import marker: ${expectedMarker}`);
  }
}

function run(command, args, cwd, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Built runtime smoke timed out: ${command} ${args.join(" ")}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(
          new Error(`Built runtime smoke failed (${String(code ?? signal)}): ${stderr || stdout}`),
        );
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}
