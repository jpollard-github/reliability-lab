import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/check-documentation.mjs");
const ownershipDocuments = [
  "reliability-lab-ownership-and-design-review-basics.md",
  "design-review-walkthrough.md",
  "change-recipes.md",
  "product-tour-and-operator-guidance.md",
  "reliability-lab-case-driven-policy-experiments-basics.md",
  "built-runtime.md",
];

describe("documentation audit", () => {
  it("accepts portable relative links and ignores fenced examples", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, "README.md"),
      `${ownershipDocuments.map((file) => `[guide](docs/${file})`).join("\n")}
[architecture](docs/architecture.md)

\`\`\`text
/Users/example/repository
\`\`\`
`,
    );
    await writeFile(join(directory, "docs/architecture.md"), "# Architecture\n");
    await run("git", ["add", "."], directory);

    const result = await run(process.execPath, [script], directory);
    expect(result.stdout).toContain("Documentation audit passed");
  });

  it("reports broken links with their file and line", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, "README.md"),
      `${ownershipDocuments.map((file) => `[guide](docs/${file})`).join("\n")}
[missing](docs/missing.md)
`,
    );
    await run("git", ["add", "."], directory);

    const result = await run(process.execPath, [script], directory, true);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      `README.md:${ownershipDocuments.length + 1}: unresolved relative link docs/missing.md`,
    );
  });

  it("rejects an unguarded local absolute path", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, "README.md"),
      `${ownershipDocuments.map((file) => `[guide](docs/${file})`).join("\n")}
Local checkout: /Users/example/reliability-lab
`,
    );
    await run("git", ["add", "."], directory);

    const result = await run(process.execPath, [script], directory, true);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      `README.md:${ownershipDocuments.length + 1}: local absolute path is not portable`,
    );
  });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "documentation-audit-test-"));
  await run("git", ["init", "-b", "main"], directory);
  await mkdir(join(directory, "docs"));
  for (const file of ownershipDocuments) {
    await writeFile(join(directory, "docs", file), `# ${file}\n`);
  }
  return directory;
}

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
