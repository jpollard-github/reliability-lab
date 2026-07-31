import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const requiredDocuments = [
  "docs/reliability-lab-ownership-and-design-review-basics.md",
  "docs/design-review-walkthrough.md",
  "docs/change-recipes.md",
  "docs/product-tour-and-operator-guidance.md",
  "docs/reliability-lab-case-driven-policy-experiments-basics.md",
  "docs/reliability-lab-live-provider-proof-basics.md",
  "docs/built-runtime.md",
];
const requiredReadmeLinks = requiredDocuments.map((document) => `(${document})`);

const markdownFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .sort();

for (const document of requiredDocuments) {
  if (!fs.existsSync(path.join(root, document))) {
    failures.push(`${document}: required ownership document is missing`);
  }
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
for (const link of requiredReadmeLinks) {
  if (!readme.includes(link)) {
    failures.push(`README.md: missing ownership-document link ${link.slice(1, -1)}`);
  }
}

for (const file of markdownFiles) {
  auditMarkdownFile(file);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`documentation error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation audit passed (${markdownFiles.length} Markdown files).`);
}

function auditMarkdownFile(file) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/u);
  let fenceMarker = null;

  for (const [index, line] of lines.entries()) {
    const fence = line.match(/^\s*(```|~~~)/u)?.[1] ?? null;
    if (fence) {
      fenceMarker = fenceMarker === fence ? null : (fenceMarker ?? fence);
      continue;
    }
    if (fenceMarker) continue;

    const lineNumber = index + 1;
    checkLocalAbsolutePaths(file, lineNumber, line);
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      checkRelativeLink(file, lineNumber, match[1]);
    }
  }
}

function checkLocalAbsolutePaths(file, lineNumber, line) {
  const localPathPatterns = [
    /(?:^|[\s("'`])\/Users\/[^\s)]+/u,
    /(?:^|[\s("'`])\/home\/[^\s)]+/u,
    /(?:^|[\s("'`])\/private\/(?:tmp|var)\/[^\s)]+/u,
    /(?:^|[\s("'`])[A-Za-z]:[\\/][^\s)]+/u,
  ];
  if (localPathPatterns.some((pattern) => pattern.test(line))) {
    failures.push(`${file}:${lineNumber}: local absolute path is not portable`);
  }
}

function checkRelativeLink(file, lineNumber, rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const closing = target.indexOf(">");
    target = closing >= 0 ? target.slice(1, closing) : target;
  } else {
    target = target.split(/\s+["']/u)[0] ?? target;
  }
  if (
    !target ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(target)
  ) {
    return;
  }

  const withoutFragment = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!withoutFragment) return;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    failures.push(`${file}:${lineNumber}: malformed relative link ${rawTarget}`);
    return;
  }
  const resolved = path.resolve(root, path.dirname(file), decoded);
  if (!isInsideRoot(resolved) || !fs.existsSync(resolved)) {
    failures.push(`${file}:${lineNumber}: unresolved relative link ${rawTarget}`);
  }
}

function isInsideRoot(candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
