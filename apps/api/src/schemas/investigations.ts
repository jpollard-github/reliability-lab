import { Type } from "@sinclair/typebox";
import {
  ExecutionStatusSchema,
  InvestigationSignalSchema,
  ProviderErrorCategorySchema,
} from "@reliability-lab/contracts";

const StringArrayQuerySchema = Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
  minItems: 1,
  maxItems: 20,
});
const StatusArrayQuerySchema = Type.Array(ExecutionStatusSchema, {
  minItems: 1,
  maxItems: 6,
});
const InvestigationRangeQueryProperties = {
  from: Type.Optional(Type.String({ format: "date-time" })),
  to: Type.Optional(Type.String({ format: "date-time" })),
};

export const InvestigationExecutionQuerySchema = Type.Object(
  {
    ...InvestigationRangeQueryProperties,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    status: Type.Optional(StatusArrayQuerySchema),
    provider: Type.Optional(StringArrayQuerySchema),
    model: Type.Optional(StringArrayQuerySchema),
    errorCategory: Type.Optional(ProviderErrorCategorySchema),
    errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    signal: Type.Optional(InvestigationSignalSchema),
  },
  { additionalProperties: false },
);

export const InvestigationProviderQuerySchema = Type.Object(
  {
    ...InvestigationRangeQueryProperties,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    provider: Type.Optional(StringArrayQuerySchema),
    model: Type.Optional(StringArrayQuerySchema),
  },
  { additionalProperties: false },
);

export const InvestigationSummaryQuerySchema = Type.Object(InvestigationRangeQueryProperties, {
  additionalProperties: false,
});
