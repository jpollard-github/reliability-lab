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
const webRoot = path.join(repositoryRoot, "apps/web");
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
checkWebStructure();
checkGuidanceStructure();
requireFiles([
  "packages/db/src/database/database.ts",
  "packages/db/src/investigation/execution-search-query.ts",
  "packages/db/src/investigation/reliability-summary-query.ts",
  "packages/db/src/investigation/provider-observations-query.ts",
  "apps/api/src/http/error-mapper.ts",
  "apps/api/src/routes/execution-events.ts",
  "apps/api/src/routes/investigation-cases.ts",
  "apps/web/features/investigations/search-state.ts",
  "apps/web/features/investigations/workbench-loader.ts",
  "apps/web/features/investigations/reliability-summary-cards.tsx",
  "apps/web/features/investigations/outcome-trend.tsx",
  "apps/web/features/investigations/provider-observations.tsx",
  "apps/web/features/investigations/execution-explorer.tsx",
  "apps/web/features/live-machine/use-execution-stream.ts",
  "apps/web/features/live-machine/use-event-playback.ts",
  "apps/web/features/live-machine/machine-route.tsx",
  "apps/web/features/comparisons/comparison-draft.ts",
  "apps/web/features/comparisons/comparison-presets.ts",
  "apps/web/features/investigation-cases/case-controls.tsx",
  "apps/web/features/investigation-cases/case-mutations.ts",
  "apps/web/features/investigation-cases/case-evidence.tsx",
  "apps/web/app/guide/page.tsx",
  "apps/web/features/guidance/guide-content.ts",
  "apps/web/features/guidance/guide-page.tsx",
  "apps/web/features/guidance/concept-help.tsx",
  "apps/web/features/guidance/page-tour.tsx",
  "apps/web/features/guidance/tour-launcher.tsx",
  "apps/web/features/guidance/tour-registry.ts",
  "apps/web/features/guidance/tour-state.ts",
  "apps/web/styles/guidance.css",
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
    .filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
}

function checkWebStructure() {
  const productionRoots = ["app", "components", "features", "lib", "styles"].map((directory) =>
    path.join(webRoot, directory),
  );
  const productionFiles = productionRoots
    .filter(fs.existsSync)
    .flatMap((directory) => webProductionFiles(directory));
  for (const file of productionFiles) {
    checkLineCount(file);
    if (file.endsWith(".ts") || file.endsWith(".tsx")) checkClientServerImports(file);
  }

  for (const page of productionFiles.filter((file) => file.endsWith(`${path.sep}page.tsx`))) {
    const count = lineCount(page);
    if (count > 300) failures.push(`${relative(page)} has ${count} lines (page ceiling: 300)`);
    else if (count > 250) warnings.push(`${relative(page)} has ${count} lines (page target: 250)`);
  }

  const globals = path.join(webRoot, "app/globals.css");
  const globalLines = fs.readFileSync(globals, "utf8").split(/\r?\n/u).filter(Boolean);
  if (globalLines.length > 50 || globalLines.some((line) => !line.startsWith("@import "))) {
    failures.push("apps/web/app/globals.css must be a small ordered import map");
  }

  for (const testFile of recursiveFiles(path.join(webRoot, "tests")).filter((file) =>
    file.endsWith(".spec.ts"),
  )) {
    const count = lineCount(testFile);
    if (count > 500) failures.push(`${relative(testFile)} has ${count} lines (test ceiling: 500)`);
  }
  if (fs.existsSync(path.join(webRoot, "tests/dashboard.spec.ts"))) {
    failures.push("apps/web/tests/dashboard.spec.ts must be replaced by workflow-named specs");
  }
  checkFeatureCycles(path.join(webRoot, "features"));
}

function checkGuidanceStructure() {
  const layout = path.join(webRoot, "app/layout.tsx");
  const layoutSource = fs.readFileSync(layout, "utf8");
  if (/\b(?:GuideStep|pageTours|operatorWorkflow|steps\s*:)\b/u.test(layoutSource)) {
    failures.push("apps/web/app/layout.tsx must compose guidance, not embed guidance content");
  }

  for (const page of recursiveFiles(path.join(webRoot, "app")).filter((file) =>
    file.endsWith(`${path.sep}page.tsx`),
  )) {
    const source = fs.readFileSync(page, "utf8");
    if (/\b(?:prepareTour|TourLauncher|nextTourStep|previousTourStep)\b/u.test(source)) {
      failures.push(`${relative(page)} must compose guidance, not own the tour implementation`);
    }
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const forbiddenTourRuntimes = [
    "driver.js",
    "intro.js",
    "react-joyride",
    "shepherd.js",
    "@reactour/tour",
  ];
  for (const dependency of dependencies) {
    if (forbiddenTourRuntimes.includes(dependency)) {
      failures.push(`apps/web/package.json adds forbidden tour runtime ${dependency}`);
    }
  }
}

function webProductionFiles(directory) {
  return recursiveFiles(directory).filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".css")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx"),
  );
}

function recursiveFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(target) : [target];
  });
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
  const count = lineCount(file);
  if (count > 650) failures.push(`${relative(file)} has ${count} lines (hard ceiling: 650)`);
  else if (count > 450) warnings.push(`${relative(file)} has ${count} lines (soft threshold: 450)`);
  if (relative(file) === "apps/api/src/app.ts" && count > 250) {
    failures.push(`${relative(file)} has ${count} lines (composition-root ceiling: 250)`);
  }
  if (relative(file).startsWith("apps/api/src/routes/") && count > 400) {
    warnings.push(`${relative(file)} has ${count} lines (route-module target: 400)`);
  }
}

function lineCount(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).length;
}

function checkClientServerImports(file) {
  const source = sourceFile(file);
  const isClient = source.statements.some(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) &&
      statement.expression.text === "use client",
  );
  if (!isClient) return;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (/server-api|workbench-loader/u.test(specifier)) {
      failures.push(`${relative(file)} imports server-only module ${specifier}`);
    }
  }
}

function checkFeatureCycles(featuresRoot) {
  const files = recursiveFiles(featuresRoot).filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx"),
  );
  const fileSet = new Set(files);
  const graph = new Map(files.map((file) => [file, runtimeFeatureImports(file, fileSet)]));
  const visiting = new Set();
  const visited = new Set();

  function visit(file, trail) {
    if (visiting.has(file)) {
      const start = trail.indexOf(file);
      failures.push(
        `apps/web feature runtime cycle: ${trail.slice(start).concat(file).map(relative).join(" -> ")}`,
      );
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of files) visit(file, []);
}

function runtimeFeatureImports(file, fileSet) {
  const source = sourceFile(file);
  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) return [];
    const base = path.resolve(path.dirname(file), specifier);
    const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
    const dependency = candidates.find((candidate) => fileSet.has(candidate));
    return dependency ? [dependency] : [];
  });
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
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function relative(file) {
  return path.relative(repositoryRoot, file);
}
