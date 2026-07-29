import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const repositoryRoot = process.cwd();
const packages = [
  { name: "@reliability-lab/contracts", root: "packages/contracts/src" },
  { name: "@reliability-lab/core", root: "packages/core/src" },
];
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
