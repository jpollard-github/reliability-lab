import { Ajv, type ErrorObject } from "ajv/dist/ajv.js";
import type { StructuredOutputValidation } from "@reliability-lab/contracts";

/**
 * Validates provider JSON against caller-supplied dynamic schemas with Ajv.
 * Project-owned HTTP contracts remain TypeBox schemas and do not pass through this class.
 */
export class StructuredOutputValidator {
  readonly #ajv = new Ajv({ allErrors: true, strict: false });

  validate(schema: Record<string, unknown>, data: unknown): StructuredOutputValidation {
    const validate = this.#ajv.compile(schema);
    const valid = validate(data);
    return {
      valid,
      ...(valid
        ? {}
        : {
            errors: (validate.errors ?? []).map(
              (error: ErrorObject) => `${error.instancePath} ${error.message}`,
            ),
          }),
    };
  }
}
