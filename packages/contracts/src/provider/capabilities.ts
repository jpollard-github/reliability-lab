import { Type, type Static } from "@sinclair/typebox";

/**
 * Public-safe provider configuration evidence.
 * It deliberately excludes credentials, endpoints, request bodies, and raw environment values.
 */
export const ProviderCapabilitySchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    kind: Type.Union([Type.Literal("deterministic"), Type.Literal("live")]),
    modelLabel: Type.String({ minLength: 1, maxLength: 128 }),
    transportFamily: Type.Union([
      Type.Literal("in_process_fixture"),
      Type.Literal("openai_compatible_chat_completions"),
    ]),
    configured: Type.Boolean(),
    supportsFailureInjection: Type.Boolean(),
    operatorEligible: Type.Boolean(),
    unavailableReason: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ProviderCapability = Static<typeof ProviderCapabilitySchema>;

export const ProviderCapabilityListSchema = Type.Object(
  {
    data: Type.Array(ProviderCapabilitySchema, { maxItems: 10 }),
    count: Type.Integer({ minimum: 0, maximum: 10 }),
  },
  { additionalProperties: false },
);
export type ProviderCapabilityList = Static<typeof ProviderCapabilityListSchema>;
