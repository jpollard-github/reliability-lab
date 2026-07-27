import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const exportDirectory = join(root, "artifacts", "exports");

await requireRepositoryRoot();
const candidates = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
  .split("\0")
  .filter(Boolean)
  .filter((path) => !path.startsWith("artifacts/exports/"))
  .filter((path) => !path.endsWith(".tar.gz"));

if (candidates.length === 0) fail("No exportable repository files were found.");
for (const path of candidates) {
  rejectUnsafeName(path);
  await rejectUnsafePath(path);
}

if (dryRun) {
  process.stdout.write(
    `Repository export dry run (${candidates.length} files):\n${candidates.join("\n")}\n`,
  );
  process.exit(0);
}

const staging = await mkdtemp(join(tmpdir(), "reliability-lab-export-"));
try {
  const files = [];
  for (const path of candidates) {
    const source = join(root, path);
    const destination = join(staging, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await cp(source, destination, { preserveTimestamps: true });
    const metadata = await stat(source);
    files.push({ path, size: metadata.size, sha256: await sha256(source) });
  }

  const timestamp = new Date().toISOString();
  const commit = await gitOptional(["rev-parse", "HEAD"]);
  const branch = await gitOptional(["branch", "--show-current"]);
  const dirty = (await git(["status", "--porcelain"])).length > 0;
  await writeFile(
    join(staging, "EXPORT-MANIFEST.json"),
    `${JSON.stringify(
      {
        exportTimestamp: timestamp,
        repositoryName: basename(root),
        gitCommit: commit || null,
        branch: branch || null,
        dirty,
        files,
      },
      null,
      2,
    )}\n`,
  );

  await mkdir(exportDirectory, { recursive: true });
  const archiveName = `${basename(root)}-${timestamp.replaceAll(":", "-")}.tar.gz`;
  const archive = join(exportDirectory, archiveName);
  await command("tar", ["-czf", archive, "-C", staging, "."]);
  const archiveStat = await stat(archive);
  process.stdout.write(`Created ${archive} (${archiveStat.size} bytes, ${files.length} files)\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

async function requireRepositoryRoot() {
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (resolve(top) !== root) fail("Run this command from the repository root.");
}

function rejectUnsafeName(path) {
  const normalized = path.toLowerCase();
  const safeExample = normalized.endsWith(".env.example");
  const secretPatterns = [
    /(^|\/)\.env($|\.)(?!example$)/,
    /(^|\/)(id_rsa|id_ed25519|credentials?|secrets?|tokens?)(\.|$)/,
    /\.(pem|key|p12|pfx|kdbx)$/,
    /(^|\/)(cookies|login data)$/,
    /(credential|secret|token)[-_]?dump/,
  ];
  if (!safeExample && secretPatterns.some((pattern) => pattern.test(normalized))) {
    fail(`Refusing to export likely secret file: ${path}`);
  }
}

async function rejectUnsafePath(path) {
  if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) fail(`Unsafe export path: ${path}`);
  const source = join(root, path);
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) {
    const target = await realpath(source);
    if (!isInside(root, target)) fail(`Symlink resolves outside the repository: ${path}`);
  }
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function git(args) {
  return (await command("git", args)).trim();
}

async function gitOptional(args) {
  try {
    return await git(args);
  } catch {
    return "";
  }
}

function command(program, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${program} exited ${code}: ${stderr.trim()}`));
    });
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
