import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repositoryRoot = process.cwd();
const packages = [
  { name: "@reliability-lab/contracts", root: "packages/contracts/src" },
  { name: "@reliability-lab/core", root: "packages/core/src" },
  { name: "@reliability-lab/db", root: "packages/db/src" },
];
const apiRoot = path.join(repositoryRoot, "apps/api/src");
const failures = [];
const warnings = [];

for (const packageInfo of packages) {
  const sourceRoot = path.join(repositoryRoot, packageInfo.root);
  const rootIndex = path.join(sourceRoot, "index.ts");
  const files = productionTypeScriptFiles(sourceRoot);

  checkRootBarrel(rootIndex);
  for (const file of files) {
    checkLineCount(file);
    checkInternalImports(file, packageInfo, rootIndex);
  }
}

checkExportOnly(path.join(repositoryRoot, "packages/db/src/schema.ts"));
for (const file of productionTypeScriptFiles(apiRoot)) {
  checkLineCount(file);
  checkApiComposition(file);
}
requireFiles([
  "packages/db/src/database/database.ts",
  "packages/db/src/investigation/execution-search-query.ts",
  "packages/db/src/investigation/reliability-summary-query.ts",
  "packages/db/src/investigation/provider-observations-query.ts",
  "apps/api/src/http/error-mapper.ts",
  "apps/api/src/routes/execution-events.ts",
  "apps/api/src/routes/investigation-cases.ts",
]);

for (const warning of warnings) console.warn(`structure warning: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`structure error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Source structure audit passed.");
}

function productionTypeScriptFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? productionTypeScriptFiles(target) : [target];
    })
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

function checkRootBarrel(file) {
  checkExportOnly(file);
}

function checkExportOnly(file) {
  const source = sourceFile(file);
  for (const statement of source.statements) {
    const allowedExport = ts.isExportDeclaration(statement);
    const allowedTypeImport =
      ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true;
    if (!allowedExport && !allowedTypeImport) {
      failures.push(
        `${relative(file)} must be export-only; found ${ts.SyntaxKind[statement.kind]}`,
      );
    }
  }
}

function checkLineCount(file) {
  const count = fs.readFileSync(file, "utf8").split(/\r?\n/u).length;
  if (count > 650) failures.push(`${relative(file)} has ${count} lines (hard ceiling: 650)`);
  else if (count > 450) warnings.push(`${relative(file)} has ${count} lines (soft threshold: 450)`);
  if (relative(file) === "apps/api/src/app.ts" && count > 250) {
    failures.push(`${relative(file)} has ${count} lines (composition-root ceiling: 250)`);
  }
  if (relative(file).startsWith("apps/api/src/routes/") && count > 400) {
    warnings.push(`${relative(file)} has ${count} lines (route-module target: 400)`);
  }
}

function checkInternalImports(file, packageInfo, rootIndex) {
  const source = sourceFile(file);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === packageInfo.name) {
      failures.push(`${relative(file)} imports its own package root (${specifier})`);
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/u, ".ts"));
    if (resolved === rootIndex) {
      failures.push(`${relative(file)} imports its own root barrel (${specifier})`);
    }
  }
}

function checkApiComposition(file) {
  if (relative(file) !== "apps/api/src/app.ts") return;
  const source = fs.readFileSync(file, "utf8");
  if (/\bapp\.(?:get|post|patch|delete|put)\s*\(/u.test(source)) {
    failures.push(`${relative(file)} must register feature route plugins, not define routes`);
  }
}

function requireFiles(files) {
  for (const file of files) {
    if (!fs.existsSync(path.join(repositoryRoot, file))) {
      failures.push(`${file} is required for feature-name navigation`);
    }
  }
}

function sourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function relative(file) {
  return path.relative(repositoryRoot, file);
}
