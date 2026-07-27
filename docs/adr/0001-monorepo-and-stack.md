# ADR 0001: pnpm monorepo and platform stack

Status: accepted, 2026-07-27.

Use a pnpm TypeScript monorepo with Fastify/TypeBox, Next.js App Router, PostgreSQL/Drizzle, Redis
client contracts, Pino, OpenTelemetry, Vitest, and Playwright.

This keeps contracts, domain policy, adapters, and applications independently testable while one
lockfile pins compatible versions. Fastify provides fast injection tests and schema-driven
transport; Next.js provides the operator UI; PostgreSQL fits typed queries plus JSONB event payloads;
Redis is the intended distributed coordination substrate; OpenTelemetry is vendor-neutral.

The cost is workspace configuration and multiple build surfaces. Packages must not become artificial
layers: imports follow domain → ports, with frameworks at composition edges.
