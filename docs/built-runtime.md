# Built Runtime

Reliability Lab has two different module-resolution modes because development tools can execute
TypeScript while production processes must execute emitted JavaScript.

## Previous failure

The workspace packages exported `./src/index.ts` unconditionally. TypeScript and `tsx` development
therefore worked, and `pnpm build` emitted JavaScript, but the built API still resolved each pnpm
workspace symlink back to a package export pointing at TypeScript source. Plain Node could not load
that source-only graph and stopped with `ERR_MODULE_NOT_FOUND`. The worker also still used `tsx` in
its `start` script, so it did not prove a production build at all.

## Package and build convention

Every public workspace package now has one conditional root export:

- `development` resolves `src/index.ts`;
- `types` resolves `dist/index.d.ts`;
- the default runtime resolves `dist/index.js`.

Normal package typechecks enable the `development` condition. API, worker, and web development
scripts pass the same condition to their source-aware tools. Package build configurations exclude
tests, emit one `dist/` tree rooted at `src/`, and resolve dependency declarations from already
built workspace packages. API and worker build configurations emit `dist/server.js`.

This keeps package-root `src/index.ts` files as public export maps without copying dependency source
trees into each application artifact.

## Runtime verification

`pnpm build` ends with `pnpm audit:runtime`. The bounded smoke imports every workspace package under
Node's default condition, then executes the built API and worker entrypoints through an
import-resolution-only marker. It catches a green TypeScript build whose public package exports or
process imports cannot resolve emitted JavaScript.

The smoke does not replace full process checks. Final runtime verification starts:

```bash
pnpm --filter @reliability-lab/api start
pnpm --filter @reliability-lab/worker start
```

The API check exercises health, readiness, OpenAPI, Swagger UI and one asset, plus a tenant-scoped
read. The worker check uses migrated local PostgreSQL, explicit worker mode, separate example
command/replay keyrings, and its health endpoint.

## Migration notes

There is no package publication or compatibility alias. Consumers that previously depended on
unconditional source exports must use the explicit `development` condition or build their workspace
dependencies first. `start` never invokes `tsx`. Old nested application artifacts are transitional
build output and are replaced by the new clean `dist/` layout on the next build.
