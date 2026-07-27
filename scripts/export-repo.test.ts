import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/export-repo.mjs");

describe("export-repo", () => {
  it("dry-runs tracked and non-ignored files from a temporary Git repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "export-repo-test-"));
    await run("git", ["init", "-b", "main"], directory);
    await writeFile(join(directory, "tracked.txt"), "tracked");
    await writeFile(join(directory, "working.txt"), "working");
    await run("git", ["add", "tracked.txt"], directory);
    const result = await run(process.execPath, [script, "--dry-run"], directory);
    expect(result.stdout).toContain("tracked.txt");
    expect(result.stdout).toContain("working.txt");
  });

  it("fails closed when a candidate filename resembles a private key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "export-repo-secret-test-"));
    await run("git", ["init", "-b", "main"], directory);
    await writeFile(join(directory, "private.pem"), "not-a-real-key");
    await run("git", ["add", "private.pem"], directory);
    const result = await run(process.execPath, [script, "--dry-run"], directory, true);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("likely secret file");
  });
});

function run(program: string, args: string[], cwd: string, allowFailure = false) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { stdout, stderr, code: code ?? -1 };
      if (code === 0 || allowFailure) resolvePromise(result);
      else reject(new Error(stderr));
    });
  });
}
