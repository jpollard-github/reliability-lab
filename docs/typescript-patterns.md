# TypeScript Patterns Used Here

This guide explains the few patterns that carry important domain meaning.

## TypeBox schema plus `Static`

Project-owned transport contracts keep runtime validation and compile-time types together:

```ts
export const ExecutionStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
]);
export type ExecutionStatus = Static<typeof ExecutionStatusSchema>;
```

The real code is in `packages/contracts/src/execution/status.ts`. Fastify uses the schema at
runtime; TypeScript uses `ExecutionStatus` during development. A simpler alternative is a
handwritten union plus separate JSON Schema, but the two definitions can drift.

## Ajv for dynamic schemas

`StructuredOutputValidator` in
`packages/core/src/execution/structured-output-validator.ts` compiles a JSON Schema supplied with an
execution:

```ts
const validate = this.#ajv.compile(schema);
const valid = validate(data);
```

TypeBox describes contracts owned by this repository. Ajv handles a schema that arrives as data and
is not known when TypeScript compiles the project. The simpler alternative is checking only
`typeof`, which would not honor the caller's requested structure.

## Discriminated unions

Execution events, replay capabilities, evidence links, and ownership outcomes use a literal field
such as `type`, `state`, or `kind`:

```ts
if (event.type === "attempt.started") {
  return event.provider;
}
```

TypeScript narrows the object to the matching shape. The simpler alternative is optional fields on
one broad object, but that permits nonsensical combinations and makes required evidence unclear.

## Explicit event payloads and stored events

`packages/contracts/src/execution/events.ts` defines:

- named payloads such as `AttemptStartedEventPayload`;
- `ExecutionEventMetadata`;
- `ExecutionEventPayload`, the caller-input union;
- named stored events;
- `ExecutionEvent`, the stored union.

`ExecutionEventRecorder` accepts `ExecutionEventPayload` and adds schema version, event ID,
execution ID, sequence, and time:

```ts
const event = {
  ...payload,
  schemaVersion: 1,
  eventId: this.#ids.eventId(),
  executionId: execution.executionId,
  sequence: execution.events.length + 1,
  occurredAt: this.#clock.now().toISOString(),
} satisfies ExecutionEvent;
```

Previously, payloads were derived by a distributive conditional `Omit`. That was shorter but
required advanced compiler knowledge. The explicit model is longer and directly readable.

## JavaScript `#private`

Classes such as `ExecutionService`, `ExecutionRunner`, and `LeaseHeartbeatController` use runtime
private fields:

```ts
readonly #repository: ExecutionRepository;
```

Unlike TypeScript's `private`, `#repository` cannot be accessed at runtime from outside the class.
The simpler alternative is a public or compile-time-private property. Runtime privacy is useful
when the class is cohesive; it is not a reason to hide multiple subsystems in one giant class.

## Exact optional properties

The workspace enables `exactOptionalPropertyTypes`. An optional field means “the property may be
absent,” not automatically “the property may be present with `undefined`.”

That is why object construction often uses:

```ts
{
  ...(input.importance ? { importance: input.importance } : {}),
}
```

The simpler alternative is assigning `importance: undefined`, but that changes the runtime shape
and is rejected by the compiler under this setting.

## `satisfies`

The event recorder uses `satisfies ExecutionEvent`. This checks the constructed value without
widening it to the target type. The exact payload discriminator remains available for reasoning.

The simpler alternative is `as ExecutionEvent`, which asserts correctness and can hide a malformed
construction. `satisfies` is preferable at the one boundary that creates stored events.

## Remaining generics

The saved-case `canonicalArray<T extends string>` preserves a specific string-union element type
while trimming, deduplicating, and sorting values. The simpler alternative returns `string[]` and
requires casts at every caller. The generic is local, small, and names a familiar collection
operation; no central domain model depends on conditional-type machinery.

## Drizzle inferred row types

Persistence mappers use Drizzle's table-owned row types:

```ts
function toExecutionInsert(execution: ExecutionEnvelope): typeof executions.$inferInsert;
```

`$inferInsert` and `$inferSelect` keep mapping functions aligned with the declared schema without a
second handwritten row interface. The schema still does not become a domain model: the mapper names
the translation boundary, and `ExecutionEnvelope` remains contract-owned.

## Typed Fastify route plugins

Each API route module calls:

```ts
const api = app.withTypeProvider<TypeBoxTypeProvider>();
```

Fastify then derives request header, parameter, query, body, and reply types from the TypeBox route
schema in that module. Plugin options use `Pick<AppOptions, ...>` so a route family receives only
the composed service it needs.

With `exactOptionalPropertyTypes`, `app.ts` omits absent optional plugin settings instead of passing
properties whose value is `undefined`. This preserves both compile-time and runtime shapes.

`Type.Unsafe` remains explicit for `ExecutionEnvelopeSchema` and `ComparisonViewSchema` because
those established interfaces do not have complete runtime TypeBox schemas. It preserves the
existing OpenAPI contract without pretending that an incomplete runtime schema is domain-complete.
