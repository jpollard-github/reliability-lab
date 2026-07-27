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
import { glob } from "glob";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const configPath = join(root, ".working-files.export.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.include) || config.include.length === 0) {
  process.stdout.write("Working-files export allowlist is empty; nothing will be exported.\n");
  process.exit(0);
}
if (!Array.isArray(config.exclude) || typeof config.maxTotalBytes !== "number") {
  fail("Invalid .working-files.export.json configuration.");
}

const matches = await glob(config.include, {
  cwd: root,
  dot: true,
  nodir: true,
  ignore: [...config.exclude, "artifacts/exports/**"],
});
const candidates = [...new Set(matches)].sort();
if (candidates.length === 0) fail("The allowlist did not match any files.");

let totalBytes = 0;
const files = [];
for (const path of candidates) {
  rejectUnsafeName(path);
  const source = join(root, path);
  await rejectUnsafePath(source, path);
  const metadata = await stat(source);
  totalBytes += metadata.size;
  files.push({ sourcePath: path, size: metadata.size, sha256: await sha256(source) });
}
if (totalBytes > config.maxTotalBytes) {
  fail(
    `Allowlisted files total ${totalBytes} bytes, exceeding maxTotalBytes ${config.maxTotalBytes}.`,
  );
}

if (dryRun) {
  process.stdout.write(
    `Working-files export dry run (${files.length} files, ${totalBytes} bytes):\n${files
      .map((file) => file.sourcePath)
      .join("\n")}\n`,
  );
  process.exit(0);
}

const staging = await mkdtemp(join(tmpdir(), "reliability-lab-working-export-"));
try {
  for (const file of files) {
    const destination = join(staging, file.sourcePath);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await cp(join(root, file.sourcePath), destination, { preserveTimestamps: true });
  }
  const timestamp = new Date().toISOString();
  await writeFile(
    join(staging, "WORKING-FILES-MANIFEST.json"),
    `${JSON.stringify({ exportTimestamp: timestamp, repositoryName: basename(root), totalBytes, files }, null, 2)}\n`,
  );
  const exportDirectory = join(root, "artifacts", "exports");
  await mkdir(exportDirectory, { recursive: true });
  const archive = join(
    exportDirectory,
    `${basename(root)}-working-${timestamp.replaceAll(":", "-")}.tar.gz`,
  );
  await command("tar", ["-czf", archive, "-C", staging, "."]);
  const archiveStat = await stat(archive);
  process.stdout.write(`Created ${archive} (${archiveStat.size} bytes, ${files.length} files)\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

function rejectUnsafeName(path) {
  const normalized = path.toLowerCase();
  const patterns = [
    /(^|\/)\.env($|\.)/,
    /\.(pem|key|p12|pfx|crt|cer|kdbx)$/,
    /(^|\/)(id_rsa|id_ed25519|cookies|login data|web data|history)$/,
    /(credential|secret|token|password|auth)/,
    /\.(sqlite|sqlite3|db)$/,
  ];
  if (patterns.some((pattern) => pattern.test(normalized))) {
    fail(`Refusing to export prohibited or likely secret file: ${path}`);
  }
}

async function rejectUnsafePath(source, displayPath) {
  if (isAbsolute(displayPath) || displayPath.split(/[\\/]/u).includes("..")) {
    fail(`Unsafe allowlisted path: ${displayPath}`);
  }
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) {
    const target = await realpath(source);
    if (!isInside(root, target)) fail(`Symlink resolves outside the repository: ${displayPath}`);
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
